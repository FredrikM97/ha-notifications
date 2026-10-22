"""The frontend websocket boundary for HA Notifications."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from collections.abc import Set as AbstractSet
from typing import Any
from uuid import uuid4

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from ..automation import (
    async_validate_alerts,
    automation_id,
)
from ..automation_runtime import (
    async_cancel_run,
    automation_changes,
    automation_entity_id,
    automation_runtime_status,
    stale_automation_ids,
)
from ..configuration import (
    empty_config,
    find_alert,
    stored_config,
    upsert_alert,
    validate_config,
)
from ..const import DOMAIN
from ..history import history_store
from ..mobile_app import resolve_platforms

ERROR_CODE = "ha_notifications_error"
_WEBSOCKET_REGISTERED: set[int] = set()
_CONFIG_OR_ALERT = {
    vol.Exclusive("config", "payload"): dict,
    vol.Exclusive("alert", "payload"): dict,
}


def _entry(hass: HomeAssistant) -> Any | None:
    """Return the single configured integration entry, if one exists."""
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None


def _raw_config_for(hass: HomeAssistant) -> dict[str, Any]:
    """Return persisted configuration without blocking the recovery editor."""
    entry = _entry(hass)
    return stored_config(entry) if entry is not None else empty_config()


def _config_for(hass: HomeAssistant) -> dict[str, Any]:
    """Return the validated persisted configuration for the integration."""
    return validate_config(_raw_config_for(hass))


def _validated_alert(alert: dict[str, Any]) -> dict[str, Any]:
    """Validate one alert with the canonical configuration schema."""
    return validate_config({"alerts": [alert]})["alerts"][0]


def _automation_document(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Return the generated automations prepared by the loaded entry."""
    runtime = getattr(_entry(hass), "runtime_data", None)
    return getattr(runtime, "automations", None) or []


def _requested_config(hass: HomeAssistant, msg: dict[str, Any]) -> dict[str, Any]:
    """Return the full config from ``config`` or saved alerts plus one ``alert``."""
    if "config" in msg:
        return msg["config"]
    if "alert" in msg:
        return upsert_alert(_config_for(hass), _validated_alert(msg["alert"]))
    raise ValueError("Provide either config or alert")


def _latest_activity(
    entries: list[dict[str, Any]],
    inactive_events: set[str],
) -> dict[str, bool]:
    """Project each alert's newest sent or inactive history event to a flag."""
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
        elif event_type in inactive_events:
            activity[alert_id] = False
    return activity


def _json_safe(value: Any) -> Any:
    """Convert mapping-like route results into JSON-serializable values."""
    if isinstance(value, Mapping):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


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

    async def get_config(self, hass: HomeAssistant, msg: dict[str, Any]) -> dict[str, Any]:
        """Return canonical config, a new alert, or raw config for YAML recovery."""
        if msg.get("new", False):
            return validate_config({"alerts": [{"id": f"alert_{uuid4().hex}"}]})
        return _config_for(hass) if msg.get("validate", True) else _raw_config_for(hass)

    async def mobile_platforms(self, hass: HomeAssistant, msg: dict[str, Any]) -> dict[str, Any]:
        return resolve_platforms(hass, msg["target"])

    async def validate_config(self, hass: HomeAssistant, msg: dict[str, Any]) -> dict[str, Any]:
        """Validate a full config, or one draft alert with the saved alerts."""
        validated = validate_config(_requested_config(hass, msg))
        await async_validate_alerts(hass, validated["alerts"])
        return validated

    async def automation_status(self, hass: HomeAssistant, _msg: dict[str, Any]) -> dict[str, Any]:
        config = _config_for(hass)
        document = _automation_document(hass)
        entries = await history_store(hass, _entry(hass)).async_entries()
        notification_activity = _latest_activity(entries, {"notification_cleared", "inactive"})
        triggered_activity = _latest_activity(entries, {"inactive"})
        result = {}
        for alert in config["alerts"]:
            alert_id = alert["id"]
            runtime_status = automation_runtime_status(hass, document, alert)
            status = {
                **runtime_status,
                "running": runtime_status["current"] > 0,
                "notification_active": notification_activity.get(alert_id, False),
            }
            if alert_id in triggered_activity:
                status["triggered"] = triggered_activity[alert_id]
            result[alert_id] = status
        return result

    async def get_automations(self, hass: HomeAssistant, _msg: dict[str, Any]) -> dict[str, Any]:
        """Prepare explicit Reload recovery; never called by panel refresh."""
        self._require_entry(hass)
        automations = _automation_document(hass)
        return automation_changes(automations, stale_automation_ids(hass, automations))

    async def get_history(self, hass: HomeAssistant, msg: dict[str, Any]) -> list[dict[str, Any]]:
        return await history_store(hass, _entry(hass)).async_entries(msg.get("alert_id"))

    async def test_alert(self, hass: HomeAssistant, msg: dict[str, Any]) -> dict[str, bool]:
        """Schedule the saved alert's actions without checking conditions."""
        self._require_entry(hass)
        alert = self._require_alert(hass, msg["alert_id"])
        entity_id = automation_entity_id(hass, alert)
        if hass.states.get(entity_id) is None:
            raise ValueError("Save an alert with enabled triggers before testing it")
        await hass.services.async_call(
            "automation",
            "trigger",
            {"entity_id": entity_id, "skip_condition": True},
            blocking=False,
        )
        return {"started": True}

    async def cancel_run(self, hass: HomeAssistant, msg: dict[str, Any]) -> dict[str, bool]:
        """Stop current automation actions without changing saved enablement."""
        entry = self._require_entry(hass)
        alert = self._require_alert(hass, msg["alert_id"])
        return {"cancelled": await async_cancel_run(hass, entry, alert)}

    async def save_config(self, hass: HomeAssistant, msg: dict[str, Any]) -> dict[str, Any]:
        """Persist a full config, or one alert and only its automation document."""
        config = _requested_config(hass, msg)
        upsert_ids = None if "config" in msg else {automation_id(msg["alert"])}
        return await self._save(hass, config, upsert_ids)

    async def delete(self, hass: HomeAssistant, msg: dict[str, Any]) -> dict[str, Any]:
        alert = self._require_alert(hass, msg["alert_id"])
        config = _config_for(hass)
        alerts = [item for item in config["alerts"] if item["id"] != alert["id"]]
        return await self._save(hass, {**config, "alerts": alerts}, set(), {automation_id(alert)})

    async def _save(
        self,
        hass: HomeAssistant,
        config: dict[str, Any],
        upsert_ids: set[str] | None,
        deleted_ids: AbstractSet[str] = frozenset(),
    ) -> dict[str, Any]:
        """Persist config and return the automation API operations it requires."""
        from .. import async_save_config

        entry = self._require_entry(hass)
        previous_ids = {item["id"] for item in _automation_document(hass)}
        saved = await async_save_config(hass, entry, config)
        document = _automation_document(hass)
        current_ids = {item["id"] for item in document}
        return {
            "saved": True,
            "config": saved,
            "automation_changes": automation_changes(
                document
                if upsert_ids is None
                else [item for item in document if item["id"] in upsert_ids],
                sorted((previous_ids | deleted_ids) - current_ids),
            ),
        }

    @staticmethod
    def _require_entry(hass: HomeAssistant) -> Any:
        entry = _entry(hass)
        if entry is None:
            raise ValueError("HA Notifications has no config entry")
        return entry

    @staticmethod
    def _require_alert(hass: HomeAssistant, alert_id: str) -> dict[str, Any]:
        alert = find_alert(_config_for(hass), alert_id)
        if alert is None:
            raise ValueError(f"unknown alert_id: {alert_id}")
        return alert


def _handler(
    dispatcher: WebsocketDispatcher,
    handler: Callable[[HomeAssistant, dict[str, Any]], Awaitable[Any]],
    schema: dict[Any, Any],
) -> Any:
    """Build a Home Assistant websocket handler for a command."""

    @websocket_api.websocket_command(schema)
    @websocket_api.async_response
    async def handle(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> None:
        await dispatcher.dispatch(hass, connection, msg, handler)

    return websocket_api.require_admin(handle)


def register(hass: HomeAssistant) -> None:
    """Register supported namespaced websocket commands with Home Assistant."""
    if id(hass) in _WEBSOCKET_REGISTERED:
        return

    dispatcher = WebsocketDispatcher()
    commands = {
        "get_config": (
            dispatcher.get_config,
            {
                vol.Optional("new", default=False): bool,
                vol.Optional("validate", default=True): bool,
            },
        ),
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
        "get_automations": (dispatcher.get_automations, {}),
        "get_history": (dispatcher.get_history, {vol.Optional("alert_id"): str}),
        "cancel_run": (dispatcher.cancel_run, {vol.Required("alert_id"): str}),
        "test_alert": (dispatcher.test_alert, {vol.Required("alert_id"): str}),
        "validate_config": (dispatcher.validate_config, _CONFIG_OR_ALERT),
        "save_config": (dispatcher.save_config, _CONFIG_OR_ALERT),
        "delete": (dispatcher.delete, {vol.Required("alert_id"): str}),
    }
    for command, (handler, arguments) in commands.items():
        schema = {vol.Required("type"): f"{DOMAIN}/{command}", **arguments}
        websocket_api.async_register_command(
            hass,
            _handler(dispatcher, handler, schema),
        )
    _WEBSOCKET_REGISTERED.add(id(hass))
