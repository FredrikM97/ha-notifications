"""The controller kernel: lifecycle, runtime state, and public operations."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from homeassistant.core import Event as HassEvent
from homeassistant.core import HomeAssistant

from ..bridge import panel as panel_module
from ..bridge import websocket as frontend_websocket
from ..const import CONFIG_FILENAME, DOMAIN, STORAGE_KEY, STORAGE_VERSION
from ..features import confirmation as responses_module
from ..ha.gateway import HomeAssistantGateway
from ..support import storage as storage_module
from .lifecycle import FeatureLifecycle, FeatureServices

_LOGGER = logging.getLogger(__name__)


class HaNotificationsController:
    """The brain: wiring, setup, delegation decisions, public API."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._gateway = HomeAssistantGateway(hass)
        self._store = self._gateway.make_store(STORAGE_VERSION, STORAGE_KEY)

        self._state: dict[str, Any] = {"alerts": {}, "history": []}
        self._runtime_storage = storage_module.RuntimeStateStorage(
            hass, self._store, self._state
        )
        self._configuration_storage = storage_module.ConfigurationStorage(
            hass, CONFIG_FILENAME
        )
        self._sessions: dict[str, responses_module.ConfirmationSession] = {}

        self._started_unsub: Any = None

        self._started = False
        self._setup_complete = False
        self._reload_lock = asyncio.Lock()

        self._services = FeatureServices(
            state=self._state,
            hass=hass,
            gateway=self._gateway,
            sessions=self._sessions,
            scheduler=None,
            configuration_storage=self._configuration_storage,
        )
        self._feature_lifecycle: FeatureLifecycle | None = None

    @property
    def feature_services(self) -> FeatureServices:
        """Return the shared capability set for external composition."""

        return self._services

    def attach_feature_lifecycle(self, lifecycle: FeatureLifecycle) -> None:
        """Attach the independently composed lifecycle before setup."""

        if self._feature_lifecycle is not None:
            raise RuntimeError("Feature lifecycle is already attached")
        self._feature_lifecycle = lifecycle

    @property
    def _lifecycle(self) -> FeatureLifecycle:
        if self._feature_lifecycle is None:
            raise RuntimeError("Feature lifecycle has not been attached")
        return self._feature_lifecycle

    async def dispatch(self, route: str, *args: Any, **kwargs: Any) -> Any:
        """Invoke one composed feature route without owning its workflow."""

        return await self._lifecycle.dispatch(route, *args, **kwargs)

    # ------------------------------------------------------------------
    # Setup / unload
    # ------------------------------------------------------------------

    async def async_setup(self, *, show_in_sidebar: bool) -> None:
        """Load config/state, start watchers, and register the frontend."""

        if self._setup_complete:
            return

        try:
            await self._runtime_storage.load()
            self._runtime_storage.start()

            config = await self._load_config()
            await self._apply_config(config)
            await self._lifecycle.setup()
            await self._rebuild_sessions()

            await self._register_frontend(show_in_sidebar=show_in_sidebar)
            frontend_websocket.register(
                self._lifecycle,
                self._gateway.register_websocket_command,
            )

            if self._gateway.is_running:
                self._started = True
                await self._evaluate_all(source="startup")
            else:
                self._started_unsub = self._gateway.bus_listen_once(
                    "homeassistant_started", self._on_home_assistant_started
                )

            self._setup_complete = True
            _LOGGER.info("HA Notifications loaded")
        except Exception:
            await self.async_unload()
            raise

    async def _register_frontend(self, *, show_in_sidebar: bool) -> None:
        plan = panel_module.registration_plan(show_in_sidebar=show_in_sidebar)
        await self._gateway.register_static_path(plan.static_url, plan.static_directory)
        self._gateway.register_extra_js(plan.module_url)

        if self._gateway.panel_exists(plan.frontend_url_path):
            self._gateway.unregister_panel(plan.frontend_url_path)
        await self._gateway.register_panel(
            frontend_url_path=plan.frontend_url_path,
            webcomponent_name=plan.webcomponent_name,
            module_url=plan.module_url,
            sidebar_title=plan.sidebar_title,
            sidebar_icon=plan.sidebar_icon,
        )

    async def _on_home_assistant_started(self, _event: HassEvent) -> None:
        self._started = True
        await self._evaluate_all(source="startup")

    async def async_unload(self) -> bool:
        """Unload the controller."""

        if self._started_unsub:
            self._started_unsub()
            self._started_unsub = None

        await self._lifecycle.unload()
        self._runtime_storage.stop()

        try:
            self._gateway.unregister_panel(DOMAIN)
        except Exception:
            _LOGGER.exception("Failed to unregister HA Notifications frontend")

        await self._runtime_storage.save()
        self._started = False
        self._setup_complete = False

        return True

    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Config load/apply/reload
    # ------------------------------------------------------------------

    async def _load_config(self) -> dict[str, Any]:
        return await self._configuration_storage.load()

    async def _save_config(self, config: dict[str, Any]) -> dict[str, Any]:
        return await self._configuration_storage.save(config)

    async def _apply_config(self, config: dict[str, Any]) -> set[str]:
        await self._feature_lifecycle.unload()
        return await self._lifecycle.dispatch("alerts.apply", config)

    async def reload(self) -> None:
        """Reload configuration from disk."""

        async with self._reload_lock:
            config = await self._load_config()
            newly_enabled_alert_ids = await self._apply_config(config)
            await self._lifecycle.setup()
            await self._rebuild_sessions()

            if self._started:
                for alert_id in newly_enabled_alert_ids:
                    await self._request_condition_check(alert_id, source="enabled")

                await self._evaluate_all(source="reload")

    async def _rebuild_sessions(self) -> None:
        self._sessions.clear()
        now = self._gateway.now_utc()
        for alert_id, state in self._state["alerts"].items():
            action_id = state.get("confirmation_action_id")
            if action_id:
                await self._lifecycle.dispatch(
                    "confirmation.track", action_id, now=now, alert_id=alert_id
                )

    # ------------------------------------------------------------------
    # Trigger evaluation - scheduling only, decisions live in features/
    # ------------------------------------------------------------------

    async def _evaluate_all(self, *, source: str) -> None:
        await self._lifecycle.dispatch(
            "alerts.evaluate_all", source=source, now=self._gateway.now_utc()
        )

    async def _request_condition_check(self, alert_id: str, *, source: str) -> None:
        """Ask `features/triggering.py` to evaluate one alert's condition now.

        Pull-based (startup/reload/interval/enabled) - the push-based path
        (a tracked template firing) already knows the result and publishes
        `CONDITION_EVALUATED` directly from the gateway listener.
        """

        if not self._started:
            return

        await self._lifecycle.dispatch(
            "alerts.check",
            alert_id,
            source=source,
            now=self._gateway.now_utc(),
        )

    # ------------------------------------------------------------------
    # Public operations - called directly by bridge/websocket.py
    # ------------------------------------------------------------------


