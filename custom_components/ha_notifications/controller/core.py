"""The controller kernel: lifecycle, runtime state, and public operations."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Protocol, cast

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event as HassEvent
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from ..bridge import panel as panel_module
from ..bridge import websocket as frontend_websocket
from ..const import (
    DOMAIN,
    PANEL_MODULE,
    STATE_HISTORY,
    STATE_RUNTIME,
    STORAGE_KEY,
    STORAGE_VERSION,
    VERSION,
    StateRoot,
)
from ..support import storage as storage_module
from .lifecycle import FeatureLifecycle

_LOGGER = logging.getLogger(__name__)


class AlertConfigurationPort(Protocol):
    """Typed configuration workflow used by the controller host."""

    async def apply_config(self, config: dict[str, Any]) -> set[str]: ...


class ConfirmationRebuildPort(Protocol):
    """Typed confirmation lifecycle operation used during setup/reload."""

    async def rebuild(self) -> None: ...


class ConditionsPort(Protocol):
    """Typed condition checks used by lifecycle callbacks."""

    async def check_alert(
        self, alert_id: str, *, source: str, now: Any
    ) -> None: ...

    async def evaluate_all(self, *, source: str, now: Any) -> None: ...


class HaNotificationsController:
    """The brain: wiring, setup, delegation decisions, public API."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self._hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)

        self._state: StateRoot = {STATE_RUNTIME: {}, STATE_HISTORY: []}
        self._runtime_storage = storage_module.RuntimeStateStorage(
            self._store, self._state
        )
        self._entry = entry
        self._config_storage = storage_module.ConfigEntryStorage(hass, entry)
        self._started_unsub: Any = None
        self._entry_update_unsub: Any = None

        self._started = False
        self._setup_complete = False
        self._reload_lock = asyncio.Lock()

        self._feature_lifecycle: FeatureLifecycle | None = None

    async def create_feature_lifecycle(self) -> FeatureLifecycle:
        """Compose feature instances with their explicit dependencies."""

        return await FeatureLifecycle.async_create(
            self._hass,
            self._state,
            self._config_storage,
            self._runtime_storage,
            self.reload,
        )

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

        await self._lifecycle.wait_until_ready()
        return await self._lifecycle.dispatch(route, *args, **kwargs)

    def _register_websocket_command(self, handler: Any) -> None:
        """Register a frontend websocket handler with Home Assistant."""

        websocket_api.async_register_command(self._hass, handler)

    # ------------------------------------------------------------------
    # Setup / unload
    # ------------------------------------------------------------------

    async def async_setup(self, *, show_in_sidebar: bool) -> None:
        """Load config/state, start watchers, and register the frontend."""

        if self._setup_complete:
            return

        try:
            await self._runtime_storage.load()

            config = await self._load_config()
            await self._apply_config(config)
            await self._lifecycle.setup()
            await cast(
                ConfirmationRebuildPort,
                self._lifecycle.feature("confirmation"),
            ).rebuild()

            await self._register_frontend(show_in_sidebar=show_in_sidebar)
            frontend_websocket.register(
                self._lifecycle,
                self._register_websocket_command,
            )

            if self._hass.is_running:
                self._started = True
                await self._evaluate_all(source="startup")
            else:
                self._started_unsub = self._hass.bus.async_listen_once(
                    "homeassistant_started", self._on_home_assistant_started
                )

            self._setup_complete = True
            self._entry_update_unsub = self._entry.add_update_listener(
                self._on_entry_updated
            )
            _LOGGER.info("HA Notifications loaded")
        except Exception:
            await self.async_unload()
            raise

    async def _register_frontend(self, *, show_in_sidebar: bool) -> None:
        plan = panel_module.registration_plan(show_in_sidebar=show_in_sidebar)
        await self._hass.http.async_register_static_paths(
            [StaticPathConfig(plan.static_url, plan.static_directory, False)]
        )
        frontend.add_extra_js_url(self._hass, plan.module_url)

        if plan.frontend_url_path in self._hass.data.get(frontend.DATA_PANELS, {}):
            frontend.async_remove_panel(
                self._hass, plan.frontend_url_path, warn_if_unknown=False
            )
        await panel_custom.async_register_panel(
            hass=self._hass,
            frontend_url_path=plan.frontend_url_path,
            webcomponent_name=plan.webcomponent_name,
            module_url=plan.module_url,
            sidebar_title=plan.sidebar_title,
            sidebar_icon=plan.sidebar_icon,
        )

    async def _on_home_assistant_started(self, _event: HassEvent) -> None:
        self._started_unsub = None
        self._started = True
        await self._evaluate_all(source="startup")

    async def async_unload(self) -> bool:
        """Unload the controller."""

        self._setup_complete = False

        if self._started_unsub:
            self._started_unsub()
            self._started_unsub = None
        if self._entry_update_unsub:
            self._entry_update_unsub()
            self._entry_update_unsub = None

        await self._lifecycle.unload()

        try:
            frontend.async_remove_panel(self._hass, DOMAIN, warn_if_unknown=False)
        except Exception:
            _LOGGER.exception("Failed to unregister HA Notifications frontend")

        try:
            frontend.remove_extra_js_url(self._hass, f"{PANEL_MODULE}?v={VERSION}")
        except (KeyError, ValueError):
            pass

        await self._runtime_storage.save()
        self._started = False

        return True

    async def async_remove(self) -> None:
        """Unload the controller and remove integration-owned runtime state."""

        await self.async_unload()
        await self._runtime_storage.remove()

    # ------------------------------------------------------------------
    # Config load/apply/reload
    # ------------------------------------------------------------------

    async def _on_entry_updated(
        self, _hass: HomeAssistant, _entry: ConfigEntry
    ) -> None:
        """Apply configuration changes made through ConfigEntry options."""

        if not self._setup_complete:
            return
        await self.reload()

    async def _load_config(self) -> dict[str, Any]:
        return await self._config_storage.load()

    async def _apply_config(self, config: dict[str, Any]) -> set[str]:
        await self._lifecycle.unload()
        return await cast(
            AlertConfigurationPort,
            self._lifecycle.feature("alerts"),
        ).apply_config(config)

    async def reload(self) -> None:
        """Reload configuration from disk."""

        async with self._reload_lock:
            config = await self._load_config()
            newly_enabled_alert_ids = await self._apply_config(config)
            await self._lifecycle.setup()
            await cast(
                ConfirmationRebuildPort,
                self._lifecycle.feature("confirmation"),
            ).rebuild()

            if self._started:
                for alert_id in newly_enabled_alert_ids:
                    await self._request_condition_check(alert_id, source="enabled")

                await self._evaluate_all(source="reload")

    # ------------------------------------------------------------------
    # Trigger evaluation - scheduling only, decisions live in features/
    # ------------------------------------------------------------------

    async def _evaluate_all(self, *, source: str) -> None:
        await cast(
            ConditionsPort,
            self._lifecycle.feature("conditions"),
        ).evaluate_all(source=source, now=dt_util.utcnow())

    async def _request_condition_check(self, alert_id: str, *, source: str) -> None:
        """Ask the condition feature to evaluate one alert now.

        Pull-based (startup/reload/interval/enabled) - the push-based path
        (a tracked template firing) already knows the result and sends it
        directly to the condition feature.
        """

        if not self._started:
            return

        await cast(
            ConditionsPort,
            self._lifecycle.feature("conditions"),
        ).check_alert(alert_id, source=source, now=dt_util.utcnow())

    # ------------------------------------------------------------------
    # Public operations - called directly by bridge/websocket.py
    # ------------------------------------------------------------------


