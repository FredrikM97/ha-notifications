"""The controller kernel: lifecycle, runtime state, and public operations.

Owns the single `HomeAssistantGateway` and the generic `EventBus`. Every
actual decision (message content, recipients, trigger timing, follow-up
actions, confirmation effects, history phrasing) is made by a feature
module in `features/` that subscribed to an event this file published;
`core.py` never imports a feature module's *decision* functions directly
for the reactive engine - it only wires `register(bus)` once, publishes
facts, and answers the handful
of read queries only it can answer (gateway state, runtime state/session
dicts). `bridge/websocket.py` still calls this file's public API directly
for one-shot control-plane operations (save/delete/test/YAML).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

from homeassistant.core import Event as HassEvent, HomeAssistant

from ..bridge import panel as panel_module
from ..bridge import websocket as frontend_websocket
from ..const import (
    CONFIG_FILENAME,
    DOMAIN,
    EVENT_NOTIFICATION_ACTION,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from ..domain.condition_schema import compile_condition
from ..features import confirmation as responses_module
from ..features import follow_up_actions as actions_module
from ..features import history as history_feature_module
from ..features import notification as notification_module
from ..features import triggering as alerts_module
from ..ha.gateway import HomeAssistantGateway
from ..support import history as history_module
from ..support import storage as storage_module
from . import events as ev
from .bus import EventBus
from .commands import PersistSave, Unsubscribe
from .events import Event

_LOGGER = logging.getLogger(__name__)

# The closed set of feature modules the kernel wires up at setup - each
# owns its own event subscriptions via `register(bus)`. This is the one
# place the plugin set is visible/auditable, mirroring `commands.py`'s
# closed `Command` vocabulary.
_FEATURE_MODULES = (
    alerts_module,
    responses_module,
    notification_module,
    actions_module,
    history_feature_module,
)


class NotificationCenterController:
    """The brain: wiring, setup, delegation decisions, public API."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._gateway = HomeAssistantGateway(hass)
        self._store = self._gateway.make_store(STORAGE_VERSION, STORAGE_KEY)

        self._state: dict[str, Any] = {"alerts": {}, "history": []}
        self._alerts: dict[str, dict[str, Any]] = {}
        self._sessions: dict[str, dict[str, Any]] = {}

        self._action_event_unsub: Any = None
        self._started_unsub: Any = None

        self._tasks: set[asyncio.Task[Any]] = set()
        self._started = False
        self._reload_lock = asyncio.Lock()

        self._bus = EventBus()
        self._gateway.register_bus_responders(self._bus)
        self._gateway.register_bus_listeners(self._bus, self._store)
        self._register_bus_responders()

    @property
    def alerts(self) -> dict[str, dict[str, Any]]:
        """Expose the normalized alerts currently loaded (used by `__init__.py`)."""

        return self._alerts

    # ------------------------------------------------------------------
    # Setup / unload
    # ------------------------------------------------------------------

    async def async_setup(self, *, show_in_sidebar: bool) -> None:
        """Load config/state, start watchers, and register the frontend."""

        raw_state = await self._gateway.load_store(self._store)
        self._state = storage_module.ensure_runtime_state_shape(raw_state)

        for module in _FEATURE_MODULES:
            module.register(self._bus)

        config = await self._load_config()
        await self._apply_config(config)
        await self._rebuild_sessions()

        self._action_event_unsub = self._gateway.bus_listen(
            EVENT_NOTIFICATION_ACTION, self._on_action_event
        )

        await self._register_frontend(show_in_sidebar=show_in_sidebar)
        frontend_websocket.register(self, self._gateway.register_websocket_command)

        if self._gateway.is_running:
            self._started = True
            await self._evaluate_all(source="startup")
        else:
            self._started_unsub = self._gateway.bus_listen_once(
                "homeassistant_started", self._on_home_assistant_started
            )

        _LOGGER.info("HA Notifications loaded %d alert(s)", len(self._alerts))

    async def _register_frontend(self, *, show_in_sidebar: bool) -> None:
        plan = panel_module.registration_plan(show_in_sidebar=show_in_sidebar)
        await self._gateway.register_static_path(plan.static_url, plan.static_directory)
        self._gateway.register_extra_js(plan.module_url)

        if not self._gateway.panel_exists(plan.frontend_url_path):
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

        if self._action_event_unsub:
            self._action_event_unsub()
            self._action_event_unsub = None

        for alert_id in self._alerts:
            await self._bus.execute(Unsubscribe(alert_id))

        for task in list(self._tasks):
            if not task.done():
                task.cancel()

        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

        try:
            self._gateway.unregister_panel(DOMAIN)
        except Exception:
            _LOGGER.exception("Failed to unregister HA Notifications frontend")

        await self._gateway.save_store(self._store, self._state)

        return True

    def _schedule(self, coroutine: Any) -> None:
        task = self._gateway.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # ------------------------------------------------------------------
    # Bus query responders - the only things a feature module can ask for
    # ------------------------------------------------------------------

    def _register_bus_responders(self) -> None:
        self._bus.respond(ev.GET_ALERT, self._answer_get_alert)
        self._bus.respond(ev.GET_RUNTIME_STATE, self._answer_get_runtime_state)
        self._bus.respond(ev.GET_STATE, self._answer_get_state)
        self._bus.respond(ev.GET_SESSIONS, self._answer_get_sessions)

    async def _answer_get_alert(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        return self._alerts.get(payload["alert_id"])

    async def _answer_get_runtime_state(
        self, payload: dict[str, Any]
    ) -> dict[str, Any] | None:
        alert = self._alerts.get(payload["alert_id"])
        if alert is None:
            return None
        return alerts_module.ensure_runtime_state(self._state["alerts"], alert)

    async def _answer_get_state(self, _payload: dict[str, Any]) -> dict[str, Any]:
        return self._state

    async def _answer_get_sessions(self, _payload: dict[str, Any]) -> dict[str, Any]:
        return self._sessions

    # ------------------------------------------------------------------
    # Config load/apply/reload
    # ------------------------------------------------------------------

    async def _load_config(self) -> dict[str, Any]:
        path = Path(self._gateway.config_path(CONFIG_FILENAME))
        if not path.exists():
            await self._gateway.write_text_file(
                path, storage_module.default_config_yaml_text()
            )
            return dict(storage_module.DEFAULT_CONFIG)

        text = await self._gateway.read_text_file(path)
        return storage_module.normalize_and_validate_yaml(text)

    async def _save_config(self, config: dict[str, Any]) -> dict[str, Any]:
        normalized, text = storage_module.normalize_and_dump_yaml(config)
        await self._gateway.write_text_file(
            Path(self._gateway.config_path(CONFIG_FILENAME)), text
        )
        return normalized

    async def _apply_config(self, config: dict[str, Any]) -> set[str]:
        previous_alerts = self._alerts

        for alert_id in previous_alerts:
            await self._bus.execute(Unsubscribe(alert_id))

        self._alerts = {alert["id"]: alert for alert in config["alerts"]}
        newly_enabled_alert_ids: set[str] = set()

        for alert_id in list(self._state["alerts"]):
            if alert_id not in self._alerts:
                del self._state["alerts"][alert_id]

        for alert in self._alerts.values():
            if alert.get("enabled", True):
                previous = previous_alerts.get(alert["id"])
                if previous is not None and not previous.get("enabled", True):
                    newly_enabled_alert_ids.add(alert["id"])

            await self._bus.publish(Event(ev.ALERT_CONFIGURED, {"alert": alert}))

        return newly_enabled_alert_ids

    async def reload(self) -> None:
        """Reload configuration from disk."""

        async with self._reload_lock:
            config = await self._load_config()
            newly_enabled_alert_ids = await self._apply_config(config)
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
                await self._bus.publish(
                    Event(
                        ev.CONFIRMATION_SESSION_STARTED,
                        {
                            "session_id": action_id,
                            "alert_id": alert_id,
                            "now": now,
                        },
                    )
                )

    # ------------------------------------------------------------------
    # Trigger evaluation - scheduling only, decisions live in features/
    # ------------------------------------------------------------------

    async def _evaluate_all(self, *, source: str) -> None:
        for alert in list(self._alerts.values()):
            if not alert.get("enabled", True):
                continue
            if source == "startup" and not alert.get("monitor", {}).get(
                "startup", True
            ):
                continue
            await self._request_condition_check(alert["id"], source=source)

    async def _request_condition_check(self, alert_id: str, *, source: str) -> None:
        """Ask `features/triggering.py` to evaluate one alert's condition now.

        Pull-based (startup/reload/interval/enabled) - the push-based path
        (a tracked template firing) already knows the result and publishes
        `CONDITION_EVALUATED` directly from the gateway listener.
        """

        if not self._started or alert_id not in self._alerts:
            return

        await self._bus.publish(
            Event(
                ev.CONDITION_CHECK_REQUESTED,
                {
                    "alert_id": alert_id,
                    "source": source,
                    "now": self._gateway.now_utc(),
                },
            )
        )

    # ------------------------------------------------------------------
    # Confirmation event handling - resolve who, then publish the fact
    # ------------------------------------------------------------------

    async def _on_action_event(self, event: HassEvent) -> None:
        now = self._gateway.now_utc()
        await self._bus.publish(
            Event(
                ev.ACTION_RECEIVED,
                {
                    "event_data": event.data,
                    "now": now,
                    "user_id": event.context.user_id if event.context else None,
                },
            )
        )

    # ------------------------------------------------------------------
    # Public operations - called directly by bridge/websocket.py
    # ------------------------------------------------------------------

    async def list_alerts(self) -> list[dict[str, Any]]:
        """Return alerts with runtime information."""

        result = []
        for alert in self._alerts.values():
            state = alerts_module.ensure_runtime_state(self._state["alerts"], alert)
            result.append({**deepcopy(alert), "runtime": deepcopy(state)})
        return result

    async def save_alert(self, alert: dict[str, Any]) -> dict[str, Any]:
        """Create or update an alert.

        ``alert`` is expected to already be normalized - `bridge/websocket.py`
        normalizes every frontend payload before calling this.
        """

        config = await self._load_config()
        alert_list = list(config["alerts"])
        normalized = alert

        existing = next(
            (item for item in alert_list if item["id"] == normalized["id"]), None
        )
        now_iso = self._gateway.now_utc().isoformat()

        if existing:
            normalized["created_at"] = existing.get("created_at") or now_iso
            alert_list = [
                normalized if item["id"] == normalized["id"] else item
                for item in alert_list
            ]
        else:
            normalized["created_at"] = now_iso
            alert_list.append(normalized)

        normalized["updated_at"] = now_iso

        await self._save_config({"version": 1, "alerts": alert_list})
        await self.reload()

        return normalized

    async def delete_alert(self, alert_id: str) -> None:
        """Delete an alert."""

        alert = self._alerts.get(alert_id)
        if alert:
            try:
                await self._bus.publish(
                    Event(
                        ev.NOTIFICATION_CLEAR_REQUESTED,
                        {"alert": alert, "now": self._gateway.now_utc()},
                    )
                )
            except Exception:
                _LOGGER.exception(
                    "Failed clearing notification before deleting %s", alert_id
                )

        config = await self._load_config()
        config["alerts"] = [item for item in config["alerts"] if item["id"] != alert_id]
        await self._save_config(config)

        self._state["alerts"].pop(alert_id, None)
        self._state["history"] = history_module.remove_alert(
            self._state["history"], alert_id
        )

        await self.reload()
        await self._bus.execute(PersistSave("runtime_state", self._state))

    async def test_alert(self, alert_id: str) -> None:
        """Send a test notification for a saved alert."""

        alert = self._alerts.get(alert_id)
        if alert is None:
            raise ValueError(f"Unknown alert: {alert_id}")

        confirmation_action_id = await self._create_test_action(alert)
        now = self._gateway.now_utc()
        await self._bus.publish(
            Event(
                ev.NOTIFICATION_SEND_REQUESTED,
                {
                    "alert": alert,
                    "attempt": 1,
                    "confirmation_action_id": confirmation_action_id,
                    "replace_existing": False,
                    "test": True,
                    "now": now,
                    "propagate_errors": True,
                    "on_sent": Event(
                        ev.NOTIFICATION_TEST_SENT,
                        {"alert": alert, "now": now},
                    ),
                },
            )
        )

    async def _create_test_action(self, alert: dict[str, Any]) -> str | None:
        confirmation = alert["notification"].get("confirmation", {})
        if not confirmation.get("enabled", False):
            return None

        action_id = f"NC_TEST_CONFIRM_{uuid.uuid4().hex}"
        await self._bus.publish(
            Event(
                ev.CONFIRMATION_SESSION_STARTED,
                {
                    "session_id": action_id,
                    "alert_id": alert["id"],
                    "set_runtime_action": True,
                    "now": self._gateway.now_utc(),
                },
            )
        )
        return action_id

    async def test_alert_payload(self, alert: dict[str, Any]) -> dict[str, str | None]:
        """Send a normalized editor draft without changing saved runtime state."""

        now = self._gateway.now_utc()

        session_id = f"NC_DRAFT_{uuid.uuid4().hex}"
        draft_alert = deepcopy(alert)
        draft_alert["id"] = session_id

        await self._bus.publish(
            Event(
                ev.CONFIRMATION_SESSION_STARTED,
                {
                    "session_id": session_id,
                    "draft_alert": draft_alert,
                    "ttl": responses_module.DRAFT_SESSION_TTL,
                    "now": now,
                },
            )
        )
        self._schedule(
            self._expire_draft_after_ttl(
                session_id, now + responses_module.DRAFT_SESSION_TTL
            )
        )

        confirmation = draft_alert["notification"].get("confirmation", {})
        confirmation_action_id = None
        if confirmation.get("enabled", False):
            confirmation_action_id = f"NC_DRAFT_CONFIRM_{uuid.uuid4().hex}"
            await self._bus.publish(
                Event(
                    ev.CONFIRMATION_SESSION_STARTED,
                    {
                        "session_id": confirmation_action_id,
                        "draft_alert": draft_alert,
                        "ttl": responses_module.DRAFT_SESSION_TTL,
                        "now": now,
                    },
                )
            )

        await self._bus.publish(
            Event(
                ev.NOTIFICATION_SEND_REQUESTED,
                {
                    "alert": draft_alert,
                    "attempt": 1,
                    "confirmation_action_id": confirmation_action_id,
                    "replace_existing": False,
                    "test": True,
                    "now": now,
                    "propagate_errors": True,
                },
            )
        )

        return {
            "session_id": session_id,
            "confirmation_action_id": confirmation_action_id,
        }

    async def _expire_draft_after_ttl(
        self, session_id: str, expires_at: datetime
    ) -> None:
        seconds = max(0, (expires_at - self._gateway.now_utc()).total_seconds())
        await asyncio.sleep(seconds)
        await self._bus.publish(
            Event(
                ev.CONFIRMATION_SESSION_DISCARD_REQUESTED,
                {"session_id": session_id, "now": self._gateway.now_utc()},
            )
        )

    async def discard_test_payload(self, session_id: str) -> None:
        """Explicitly dispose an editor draft test session."""

        await self._bus.publish(
            Event(
                ev.CONFIRMATION_SESSION_DISCARD_REQUESTED,
                {"session_id": session_id, "now": self._gateway.now_utc()},
            )
        )

    async def get_history(
        self, alert_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Return trace history."""

        return history_module.list_entries(self._state["history"], alert_id, limit)

    async def get_yaml(self) -> str:
        """Return the raw YAML configuration text."""

        path = Path(self._gateway.config_path(CONFIG_FILENAME))
        if not path.exists():
            await self._gateway.write_text_file(
                path, storage_module.default_config_yaml_text()
            )

        return await self._gateway.read_text_file(path)

    async def validate_yaml(self, text: str) -> dict[str, Any]:
        """Validate raw YAML without changing the saved config."""

        return storage_module.normalize_and_validate_yaml(text)

    async def save_yaml(self, text: str) -> dict[str, Any]:
        """Replace configuration using raw YAML."""

        normalized = storage_module.normalize_and_validate_yaml(text)
        await self._gateway.write_text_file(
            Path(self._gateway.config_path(CONFIG_FILENAME)),
            storage_module.dump_yaml_text(normalized),
        )
        await self.reload()
        return normalized

    async def validate_conditions(self, alert: dict[str, Any]) -> bool:
        """Validate and evaluate already-normalized alert conditions without saving."""

        _active, error = await self._bus.ask(
            ev.EVALUATE_CONDITION,
            {"source": compile_condition(alert)},
        )
        if error is not None:
            raise ValueError(f"Condition template failed: {error}")
        return True


async def build_controller(hass: HomeAssistant) -> NotificationCenterController:
    """Construct the controller. The only place `__init__.py` should call."""

    return NotificationCenterController(hass)

