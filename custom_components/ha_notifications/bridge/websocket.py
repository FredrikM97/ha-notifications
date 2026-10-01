"""The frontend websocket boundary for HA Notifications."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import Any

import voluptuous as vol
from homeassistant.components import automation as ha_automation
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from ..automation import (
    async_reconcile_automations,
    async_validate_alerts,
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
        return {
            alert["id"]: _automation_runtime_status(hass, document, alert)
            for alert in config["alerts"]
        }

    async def get_history(
        self, hass: HomeAssistant, msg: dict[str, Any]
    ) -> list[dict[str, Any]]:
        return await history_store(hass, _entry(hass)).async_entries(
            msg.get("alert_id")
        )

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
        "last_triggered": (
            state.attributes.get("last_triggered") if state is not None else None
        ),
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
    }
    for command, (handler, arguments) in commands.items():
        schema = {vol.Required("type"): f"{DOMAIN}/{command}", **arguments}
        websocket_api.async_register_command(
            hass,
            _handler(dispatcher, handler, schema),
        )
    _WEBSOCKET_REGISTERED.add(id(hass))
