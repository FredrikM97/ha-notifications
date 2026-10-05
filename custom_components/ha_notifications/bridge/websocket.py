"""The frontend websocket boundary for HA Notifications."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import voluptuous as vol
from homeassistant.components import automation as ha_automation
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from ..automation import (
    async_validate_alerts,
    automation_id,
)
from ..automation_runtime import (
    async_reconcile_automations,
    automation_status,
)
from ..configuration import validate_config
from ..const import COMMAND_CANCEL_RUN, DOMAIN, EVENT_COMMAND
from ..history import history_store
from ..mobile_app import resolve_platforms

ERROR_CODE = "ha_notifications_error"
_WEBSOCKET_REGISTERED: set[int] = set()


def _empty_config() -> dict[str, Any]:
    """Return the canonical empty configuration document."""
    return validate_config({"version": 1, "alerts": []})


def _entry(hass: HomeAssistant) -> Any | None:
    """Return the single configured integration entry, if one exists."""
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None


def _entry_config(entry: Any) -> dict[str, Any]:
    """Read persisted configuration, preferring options over entry data."""
    return dict(entry.options or entry.data)


def _config_for(hass: HomeAssistant) -> dict[str, Any]:
    """Return the validated persisted configuration for the integration."""
    entry = _entry(hass)
    return (
        validate_config(_entry_config(entry))
        if entry is not None
        else _empty_config()
    )


def _raw_config_for(hass: HomeAssistant) -> dict[str, Any]:
    """Return persisted configuration without blocking the recovery editor."""
    entry = _entry(hass)
    return _entry_config(entry) if entry is not None else _empty_config()


async def _automation_document(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Return the in-memory generated automation document."""
    entry = _entry(hass)
    runtime_document = getattr(
        getattr(entry, "runtime_data", None),
        "automations",
        None,
    )
    return runtime_document or []


def _notification_activity(entries: list[dict[str, Any]]) -> dict[str, bool]:
    """Project the latest send, clear, or inactive event into active view state."""
    activity: dict[str, bool] = {}
    for entry in entries:
        config = entry.get("config")
        event = entry.get("event")
        if not isinstance(config, Mapping) or not isinstance(event, Mapping):
            continue
        alert_id = config.get("id")
        event_type = event.get("type")
        if not isinstance(alert_id, str) or alert_id in activity:
            continue
        if event_type == "notification_sent":
            activity[alert_id] = True
        elif event_type in {"notification_cleared", "inactive"}:
            activity[alert_id] = False
    return activity


def _triggered_activity(entries: list[dict[str, Any]]) -> dict[str, bool]:
    """Project the latest successful condition outcome for each alert."""
    activity: dict[str, bool] = {}
    for entry in entries:
        config = entry.get("config")
        event = entry.get("event")
        if not isinstance(config, Mapping) or not isinstance(event, Mapping):
            continue
        alert_id = config.get("id")
        event_type = event.get("type")
        if not isinstance(alert_id, str) or alert_id in activity:
            continue
        if event_type == "notification_sent":
            activity[alert_id] = True
        elif event_type == "inactive":
            activity[alert_id] = False
    return activity


def _running_activity(
    entries: list[dict[str, Any]],
    automation_modes: dict[str, str],
) -> dict[str, bool]:
    """Project run activity using each automation's concurrency semantics."""
    runs: dict[tuple[str, str], bool] = {}
    restart_activity: dict[str, bool] = {}
    active_statuses = {"started", "waiting", "running"}
    terminal_statuses = {
        "cancelled",
        "completed",
        "inactive",
        "confirmation_completed",
        "confirmation_timeout",
    }
    for entry in entries:
        config = entry.get("config")
        event = entry.get("event")
        if not isinstance(config, Mapping) or not isinstance(event, Mapping):
            continue
        alert_id = config.get("id")
        flow_id = event.get("flow_id")
        event_type = event.get("type")
        if not isinstance(alert_id, str):
            continue
        if (
            not isinstance(flow_id, str)
            or not flow_id
            or event_type not in active_statuses | terminal_statuses
        ):
            continue
        if automation_modes.get(alert_id) == "restart":
            restart_activity.setdefault(
                alert_id,
                event_type in active_statuses,
            )
            continue
        key = (alert_id, flow_id)
        if key not in runs:
            runs[key] = event_type in active_statuses
    activity: dict[str, bool] = {}
    for (alert_id, _flow_id), active in runs.items():
        activity[alert_id] = activity.get(alert_id, False) or active
    activity.update(restart_activity)
    return activity


def _active_flow_ids(
    entries: list[dict[str, Any]],
    alert_id: str,
    automation_mode: str,
) -> list[str]:
    """Return the latest active history flow IDs for one alert."""
    active_statuses = {"started", "waiting", "running"}
    terminal_statuses = {
        "cancelled",
        "completed",
        "inactive",
        "confirmation_completed",
        "confirmation_timeout",
    }
    latest: dict[str, bool] = {}
    for entry in entries:
        config = entry.get("config")
        event = entry.get("event")
        if not isinstance(config, Mapping) or not isinstance(event, Mapping):
            continue
        if config.get("id") != alert_id:
            continue
        flow_id = event.get("flow_id")
        event_type = event.get("type")
        if (
            not isinstance(flow_id, str)
            or not flow_id
            or event_type not in active_statuses | terminal_statuses
            or flow_id in latest
        ):
            continue
        is_active = event_type in active_statuses
        if automation_mode == "restart":
            return [flow_id] if is_active else []
        latest[flow_id] = is_active
    return [flow_id for flow_id, is_active in latest.items() if is_active]


def _json_safe(value: Any) -> Any:
    """Convert mapping-like route results into JSON-serializable values."""
    if isinstance(value, Mapping):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _automation_entity_for(
    hass: HomeAssistant,
    alert: dict[str, Any],
) -> str:
    """Resolve the current entity ID from the generated automation unique ID."""
    unique_id = automation_id(alert)
    component = getattr(hass, "data", {}).get(ha_automation.DATA_COMPONENT)
    for entity in getattr(component, "entities", ()):
        if getattr(entity, "unique_id", None) == unique_id:
            return entity.entity_id
    return f"automation.{unique_id}"


class WebsocketDispatcher:
    """Implement websocket commands as typed methods."""

    async def dispatch(
        self,
        hass: HomeAssistant,
        connection: Any,
        msg: dict[str, Any],
        handler: Callable[[HomeAssistant, dict[str, Any]], Awaitable[Any]],
    ) -> None:
        """Run one command handler and translate failures to websocket errors."""
        try:
            result = await handler(hass, msg)
        except Exception as err:
            connection.send_error(msg["id"], ERROR_CODE, str(err) or "Command failed")
            return
        connection.send_result(msg["id"], _json_safe(result))

    async def get_config(
        self, hass: HomeAssistant, _msg: dict[str, Any]
    ) -> dict[str, Any]:
        return _raw_config_for(hass)

    async def mobile_platforms(
        self, hass: HomeAssistant, msg: dict[str, Any]
    ) -> dict[str, Any]:
        return resolve_platforms(hass, msg["target"])

    async def validate_config(
        self, hass: HomeAssistant, msg: dict[str, Any]
    ) -> dict[str, Any]:
        validated = validate_config(msg["config"])
        await async_validate_alerts(hass, validated["alerts"])
        return validated

    async def automation_status(
        self, hass: HomeAssistant, _msg: dict[str, Any]
    ) -> dict[str, Any]:
        config = _config_for(hass)
        document = await _automation_document(hass)
        entries = await history_store(hass, _entry(hass)).async_entries()
        notification_activity = _notification_activity(entries)
        triggered_activity = _triggered_activity(entries)
        result = {}
        for alert in config["alerts"]:
            alert_id = alert["id"]
            runtime_status = _automation_runtime_status(hass, document, alert)
            status = {
                **runtime_status,
                "running": runtime_status["current"] > 0,
                "notification_active": notification_activity.get(alert_id, False),
            }
            if alert_id in triggered_activity:
                status["triggered"] = triggered_activity[alert_id]
            result[alert_id] = status
        return result

    async def get_history(
        self, hass: HomeAssistant, msg: dict[str, Any]
    ) -> list[dict[str, Any]]:
        return await history_store(hass, _entry(hass)).async_entries(
            msg.get("alert_id")
        )

    async def cancel_run(
        self, hass: HomeAssistant, msg: dict[str, Any]
    ) -> dict[str, bool]:
        """Stop current automation actions without changing saved enablement."""
        entry = self._require_entry(hass)
        alert_id = msg["alert_id"]
        config = _config_for(hass)
        alert = next(
            (item for item in config["alerts"] if item["id"] == alert_id),
            None,
        )
        if alert is None:
            raise ValueError(f"unknown alert_id: {alert_id}")

        history = history_store(hass, entry)
        entries = await history.async_entries(alert_id)
        automation_mode = alert.get("automation_mode", "restart")
        running = _running_activity(entries, {alert_id: automation_mode}).get(
            alert_id,
            False,
        )
        document = await _automation_document(hass)
        runtime_status = _automation_runtime_status(hass, document, alert)
        if not running and runtime_status["current"] == 0:
            return {"cancelled": False}

        hass.bus.async_fire(
            EVENT_COMMAND,
            {"alert_id": alert_id, "command": COMMAND_CANCEL_RUN},
        )
        entity_id = _automation_entity_for(hass, alert)
        await hass.services.async_call(
            "automation",
            "turn_off",
            {"entity_id": entity_id, "stop_actions": True},
            blocking=True,
        )
        if alert.get("enabled", True):
            await hass.services.async_call(
                "automation",
                "turn_on",
                {"entity_id": entity_id},
                blocking=True,
            )

        entries = await history.async_entries(alert_id)
        for flow_id in _active_flow_ids(entries, alert_id, automation_mode):
            await history.async_record(
                alert_id,
                str(alert.get("name", alert_id)),
                "cancelled",
                "Automation run cancelled",
                {"action": "automation_cancelled"},
                flow_id=flow_id,
            )
        return {"cancelled": True}

    async def save_config(
        self, hass: HomeAssistant, msg: dict[str, Any]
    ) -> dict[str, Any]:
        from .. import async_save_config

        entry = self._require_entry(hass)
        return {
            "saved": True,
            "config": await async_save_config(hass, entry, msg["config"]),
        }

    async def delete(
        self, hass: HomeAssistant, msg: dict[str, Any]
    ) -> dict[str, Any]:
        from .. import async_save_config

        entry = self._require_entry(hass)
        config = _config_for(hass)
        alert_id = msg["alert_id"]
        alerts = [alert for alert in config["alerts"] if alert["id"] != alert_id]
        if len(alerts) == len(config["alerts"]):
            raise ValueError(f"unknown alert_id: {alert_id}")
        return await async_save_config(
            hass, entry, {"version": config["version"], "alerts": alerts}
        )

    async def reload(
        self, hass: HomeAssistant, _msg: dict[str, Any]
    ) -> dict[str, Any]:
        config = _config_for(hass)
        await async_reconcile_automations(hass, config["alerts"])
        return config

    @staticmethod
    def _require_entry(hass: HomeAssistant) -> Any:
        entry = _entry(hass)
        if entry is None:
            raise ValueError("HA Notifications has no config entry")
        return entry


def _automation_runtime_status(
    hass: HomeAssistant,
    document: list[dict[str, Any]],
    alert: dict[str, Any],
) -> dict[str, Any]:
    """Combine ownership metadata with non-invasive HA runtime metadata."""
    automation_entity = _automation_entity_for(hass, alert)
    states = getattr(hass, "states", None)
    state = states.get(automation_entity) if states is not None else None
    generated = next(
        (
            item
            for item in document
            if item.get("id") == automation_id(alert)
        ),
        {},
    )
    current = state.attributes.get("current", 0) if state is not None else 0
    status = automation_status(document, alert)
    if status == "managed" and state is None:
        status = "missing"
    runtime_status = {
        "status": status,
        "enabled": state is not None and state.state == "on",
        "mode": generated.get("mode", "single"),
        "current": current if isinstance(current, int) else 0,
    }
    if generated:
        runtime_status["automation_id"] = generated["id"]
    return runtime_status


def _handler(
    dispatcher: WebsocketDispatcher,
    handler: Callable[[HomeAssistant, dict[str, Any]], Awaitable[Any]],
    schema: dict[Any, Any],
    *,
    require_admin: bool = False,
) -> Any:
    """Build a Home Assistant websocket handler for a command."""
    @websocket_api.websocket_command(schema)
    @websocket_api.async_response
    async def handle(
        hass: HomeAssistant, connection: Any, msg: dict[str, Any]
    ) -> None:
        await dispatcher.dispatch(hass, connection, msg, handler)

    return websocket_api.require_admin(handle) if require_admin else handle


def register(hass: HomeAssistant) -> None:
    """Register supported namespaced websocket commands with Home Assistant."""
    if id(hass) in _WEBSOCKET_REGISTERED:
        return

    dispatcher = WebsocketDispatcher()
    commands = {
        "get_config": (dispatcher.get_config, {}),
        "mobile_platforms": (
            dispatcher.mobile_platforms,
            {
                vol.Required("target"): vol.Schema(
                    {
                        **cv.TARGET_SERVICE_FIELDS,
                        vol.Optional("user_id"): vol.All(cv.ensure_list, [str]),
                    },
                    extra=vol.ALLOW_EXTRA,
                ),
            },
        ),
        "automation_status": (dispatcher.automation_status, {}),
        "get_history": (dispatcher.get_history, {vol.Optional("alert_id"): str}),
        "cancel_run": (dispatcher.cancel_run, {vol.Required("alert_id"): str}),
        "validate_config": (dispatcher.validate_config, {vol.Required("config"): dict}),
        "save_config": (dispatcher.save_config, {vol.Required("config"): dict}),
        "delete": (dispatcher.delete, {vol.Required("alert_id"): str}),
        "reload": (dispatcher.reload, {}),
    }
    for command, (handler, arguments) in commands.items():
        schema = {vol.Required("type"): f"{DOMAIN}/{command}", **arguments}
        websocket_api.async_register_command(
            hass,
            _handler(
                dispatcher, handler, schema,
                require_admin=command == "mobile_platforms",
            ),
        )
    _WEBSOCKET_REGISTERED.add(id(hass))
