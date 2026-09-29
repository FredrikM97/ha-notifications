"""The frontend websocket boundary for HA Notifications."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import voluptuous as vol
from homeassistant.components import automation as ha_automation
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from ..automation import (
    async_reconcile_automations,
    automation_id,
    automation_status,
)
from ..configuration import validate_config
from ..const import DOMAIN
from ..history import history_store

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


def _automation_state_is_available(
    hass: HomeAssistant,
    entity_id: str,
) -> bool:
    """Return whether an automation entity exists and is available."""
    states = getattr(hass, "states", None)
    if states is None:
        return True
    state = states.get(entity_id)
    return state is not None and getattr(state, "state", "available") != "unavailable"


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

    async def validate_config(
        self, _hass: HomeAssistant, msg: dict[str, Any]
    ) -> dict[str, Any]:
        return validate_config(msg["config"])

    async def automation_status(
        self, hass: HomeAssistant, _msg: dict[str, Any]
    ) -> dict[str, Any]:
        config = _config_for(hass)
        document = await _automation_document(hass)
        return {
            alert["id"]: _automation_runtime_status(hass, document, alert)
            for alert in config["alerts"]
        }

    async def get_history(
        self, hass: HomeAssistant, msg: dict[str, Any]
    ) -> list[dict[str, Any]]:
        entry = _entry(hass)
        if entry is None:
            raise ValueError("HA Notifications has no config entry")
        return await history_store(entry).async_entries(msg.get("alert_id"))

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

    async def trigger(
        self, hass: HomeAssistant, msg: dict[str, Any]
    ) -> dict[str, Any]:
        config = _config_for(hass)
        alert_id = msg["alert_id"]
        alert = next(
            (item for item in config["alerts"] if item["id"] == alert_id),
            None,
        )
        if alert is None:
            raise ValueError(f"unknown alert_id: {alert_id}")
        automation_entity = _automation_entity_for(hass, alert)
        if not _automation_state_is_available(hass, automation_entity):
            await async_reconcile_automations(hass, config["alerts"])
            automation_entity = _automation_entity_for(hass, alert)
            if not _automation_state_is_available(hass, automation_entity):
                raise HomeAssistantError(
                    f"Generated automation {automation_id(alert)} has no available "
                    f"entity (tried {automation_entity}). "
                    "Check that the generated automation include is loaded."
                )
        await hass.services.async_call(
            "automation",
            "trigger",
            {"entity_id": automation_entity, "skip_condition": False},
            blocking=True,
        )
        return {"triggered": True, "alert_id": alert_id}

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
    entry = _entry(hass)
    tracker = getattr(getattr(entry, "runtime_data", None), "automation_runs", None)
    generated = next(
        (
            item
            for item in document
            if item.get("id") == automation_id(alert)
        ),
        {},
    )
    runtime = (
        tracker.status(alert["id"])
        if tracker is not None and hasattr(tracker, "status")
        else {
            "active_runs": 0,
            "active_runs_waiting": 0,
            "active_runs_running": 0,
            "active_runs_uncertain": True,
        }
    )
    status = automation_status(document, alert)
    if status == "managed" and state is None:
        status = "missing"
    return {
        "status": status,
        "enabled": state is not None and state.state == "on",
        "last_triggered": (
            state.attributes.get("last_triggered") if state is not None else None
        ),
        "mode": generated.get("mode", "single"),
        **runtime,
    }


def _handler(
    dispatcher: WebsocketDispatcher,
    handler: Callable[[HomeAssistant, dict[str, Any]], Awaitable[Any]],
    schema: dict[Any, Any],
) -> Any:
    """Build a Home Assistant websocket handler for a command."""
    @websocket_api.websocket_command(schema)
    @websocket_api.async_response
    async def handle(
        hass: HomeAssistant, connection: Any, msg: dict[str, Any]
    ) -> None:
        await dispatcher.dispatch(hass, connection, msg, handler)

    return handle


def register(hass: HomeAssistant) -> None:
    """Register supported namespaced websocket commands with Home Assistant."""
    if id(hass) in _WEBSOCKET_REGISTERED:
        return

    dispatcher = WebsocketDispatcher()
    commands = {
        "get_config": (dispatcher.get_config, {}),
        "automation_status": (dispatcher.automation_status, {}),
        "get_history": (dispatcher.get_history, {vol.Optional("alert_id"): str}),
        "validate_config": (dispatcher.validate_config, {vol.Required("config"): dict}),
        "save_config": (dispatcher.save_config, {vol.Required("config"): dict}),
        "delete": (dispatcher.delete, {vol.Required("alert_id"): str}),
        "reload": (dispatcher.reload, {}),
        "trigger": (dispatcher.trigger, {vol.Required("alert_id"): str}),
    }
    for command, (handler, arguments) in commands.items():
        schema = {vol.Required("type"): f"{DOMAIN}/{command}", **arguments}
        websocket_api.async_register_command(
            hass,
            _handler(dispatcher, handler, schema),
        )
    _WEBSOCKET_REGISTERED.add(id(hass))
