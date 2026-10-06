"""Minimal delivery services for generated Home Assistant automations."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.template import Template

from .const import (
    DOMAIN,
    EVENT_COMMAND,
    SERVICE_CLEAR,
    SERVICE_COMMAND,
    SERVICE_REPORT,
    SERVICE_SEND,
)
from .history import history_store
from .mobile_app import resolve_services
from .targets import resolve_target

_LOGGER = logging.getLogger(__name__)

_DELIVERY_SCHEMA = vol.Schema({
    vol.Required("payload"): {vol.Optional("data"): dict, vol.Extra: object},
    vol.Optional("action"): str,
    vol.Optional("target"): dict,
    vol.Optional("alert_id"): str,
    vol.Optional("alert_name"): str,
    vol.Optional("use_default_tag", default=True): bool,
    vol.Optional("flow_id"): str,
    vol.Optional("confirmation"): dict,
    vol.Optional("history_reason"): str,
})


def _entry(hass: HomeAssistant) -> Any:
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        raise HomeAssistantError("HA Notifications has no config entry")
    return entries[0]


async def _async_send(hass: HomeAssistant, call: ServiceCall) -> None:
    await _deliver(hass, call, False)


async def _async_clear(hass: HomeAssistant, call: ServiceCall) -> None:
    await _deliver(hass, call, True)


async def _confirmed_by(hass: HomeAssistant, details: dict[str, Any]) -> str:
    """Resolve confirmation event identifiers to a stable display name."""
    device_id = details.get("device_id")
    user_id = details.get("user_id")
    if isinstance(user_id, str) and user_id:
        for state in hass.states.async_all("person"):
            if state.attributes.get("user_id") == user_id:
                name = getattr(state, "name", "")
                if name:
                    return str(name)
        user = await hass.auth.async_get_user(user_id)
        if user is not None and user.name:
            return user.name
        return user_id
    if isinstance(device_id, str) and device_id:
        device = dr.async_get(hass).async_get(device_id)
        if device is not None:
            for name in (device.name_by_user, device.name):
                if name:
                    return str(name)
        for entry in hass.config_entries.async_entries("mobile_app"):
            entry_data = entry.data if isinstance(entry.data, dict) else {}
            if str(entry_data.get("device_id")) == device_id:
                for name in (entry.title, entry_data.get("device_name")):
                    if name:
                        return str(name)
    return "Unknown device"


async def _render_confirmation_message(
    hass: HomeAssistant,
    payload: dict[str, Any],
    call: ServiceCall,
) -> dict[str, Any]:
    """Render deferred confirmation templates in the managed send service."""
    confirmation = call.data.get("confirmation")
    if confirmation is not None:
        user_id = confirmation.get("user_id")
        variables = {
            "confirmed_by": await _confirmed_by(hass, confirmation),
            "user_id": user_id or "",
            "alert_id": call.data.get("alert_id"),
            "alert_name": call.data.get("alert_name"),
        }
        rendered = Template(payload.get("message", ""), hass).async_render(
            variables, parse_result=False
        )
        payload["message"] = str(rendered)
    return payload


async def _async_report(hass: HomeAssistant, call: ServiceCall) -> None:
    """Record a lifecycle report and update active-run state when applicable."""
    alert_id = call.data.get("alert_id")
    status = call.data.get("status")
    run_id = call.data.get("run_id")
    if not isinstance(alert_id, str) or not alert_id:
        raise HomeAssistantError(
            "ha_notifications.report requires alert_id"
        )
    if not isinstance(status, str) or not status:
        raise HomeAssistantError(
            "ha_notifications.report requires status"
        )
    if status == "started" or status.endswith("_completed") or status in {
        "waiting",
        "running",
    }:
        if not isinstance(run_id, str) or not run_id:
            raise HomeAssistantError(
                f"ha_notifications.report status {status!r} requires run_id"
            )
    details = (
        dict(call.data.get("details"))
        if isinstance(call.data.get("details"), dict)
        else {}
    )
    if status == "confirmation_completed":
        details["confirmed_by"] = await _confirmed_by(hass, details)
        details.pop("device_id", None)
        details.pop("user_id", None)
    kwargs = {}
    flow_id = call.data.get("flow_id") or call.data.get("run_id")
    if isinstance(flow_id, str) and flow_id:
        kwargs["flow_id"] = flow_id
    history = history_store(hass, _entry(hass))
    if status == "inactive":
        await history.async_record_inactive(
            alert_id,
            str(call.data.get("alert_name", alert_id)),
            str(call.data.get("message", "Condition inactive")),
            details,
            **kwargs,
        )
        return
    await history.async_record(
        alert_id,
        str(call.data.get("alert_name", alert_id)),
        status,
        str(call.data.get("message", status.replace("_", " ").title())),
        details,
        **kwargs,
    )


def _parse_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HomeAssistantError("payload must be a mapping")
    return dict(payload)


def _target_services(
    hass: HomeAssistant,
    notification: dict[str, Any],
    service_name: str,
) -> list[str]:
    target = notification.get("target")
    if not isinstance(target, dict) or not target:
        action = notification.get("action")
        if isinstance(action, str) and action.count(".") == 1:
            return [action]
        raise HomeAssistantError(
            f"ha_notifications.{service_name} requires a target or action"
        )

    resolution = resolve_target(hass, target)
    services = resolve_services(hass, resolution)
    action = notification.get("action")
    if not services and isinstance(action, str) and action.count(".") == 1:
        return [action]
    if not services:
        services = sorted(
        entity_id
        for entity_id in resolution.entity_ids
        if entity_id.startswith("notify.") and entity_id.count(".") == 1
        )
    if not services:
        raise HomeAssistantError(
            f"ha_notifications.{service_name} target did not resolve to a notify entity"
        )
    return services


def _payload(
    native_payload: dict[str, Any], clear: bool, alert_id: str | None,
    use_default_tag: bool = True,
) -> dict[str, Any]:
    payload = dict(native_payload)
    notification_data = dict(payload.get("data", {}))
    if alert_id and use_default_tag:
        notification_data.setdefault("tag", alert_id)
    if notification_data:
        payload["data"] = notification_data
    if clear:
        payload["message"] = "clear_notification"
    return payload


async def _deliver(hass: HomeAssistant, call: ServiceCall, clear: bool) -> None:
    native_payload = _parse_payload(call.data.get("payload"))
    if not clear:
        native_payload = await _render_confirmation_message(hass, native_payload, call)
    service_name = SERVICE_CLEAR if clear else SERVICE_SEND
    services = _target_services(hass, call.data, service_name)
    payload = _payload(
        native_payload, clear, call.data.get("alert_id"), call.data["use_default_tag"]
    )
    for action in services:
        domain, service = action.split(".")
        _LOGGER.debug(
            "Notification %s: action=%s alert_id=%s flow_id=%s payload=%s",
            service_name,
            action,
            call.data.get("alert_id"),
            call.data.get("flow_id"),
            payload,
        )
        try:
            await hass.services.async_call(
                domain,
                service,
                service_data=payload,
                blocking=True,
                context=call.context,
            )
        except Exception:
            _LOGGER.debug(
                "Notification %s failed: action=%s alert_id=%s payload=%s",
                service_name,
                action,
                call.data.get("alert_id"),
                payload,
                exc_info=True,
            )
            raise
        _LOGGER.debug("Notification %s completed: action=%s", service_name, action)
    alert_id = call.data.get("alert_id")
    if isinstance(alert_id, str) and alert_id:
        kwargs = {}
        flow_id = call.data.get("flow_id")
        if isinstance(flow_id, str) and flow_id:
            kwargs["flow_id"] = flow_id
        details = {"service": services[0] if len(services) == 1 else services}
        history_reason = call.data.get("history_reason")
        if isinstance(history_reason, str) and history_reason:
            details["reason"] = history_reason
        await history_store(hass, _entry(hass)).async_record(
            alert_id,
            str(call.data.get("alert_name", alert_id)),
            "notification_cleared" if clear else "notification_sent",
            "Notification cleared" if clear else "Notification sent",
            details,
            **kwargs,
        )


async def async_setup_services(hass: HomeAssistant) -> None:
    """Register the integration's Home Assistant services."""
    async def send(call: ServiceCall) -> None:
        await _deliver(hass, call, False)

    async def clear(call: ServiceCall) -> None:
        await _async_clear(hass, call)

    async def report(call: ServiceCall) -> None:
        await _async_report(hass, call)

    async def command(call: ServiceCall) -> None:
        alert_id = call.data.get("alert_id")
        command_name = call.data.get("command")
        if not isinstance(alert_id, str) or not alert_id:
            raise HomeAssistantError(
                "ha_notifications.command requires alert_id"
            )
        if not isinstance(command_name, str) or not command_name:
            raise HomeAssistantError(
                "ha_notifications.command requires command"
            )
        hass.bus.async_fire(
            EVENT_COMMAND,
            {"alert_id": alert_id, "command": command_name},
        )

    hass.services.async_register(
        DOMAIN, SERVICE_SEND, send, schema=_DELIVERY_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_CLEAR, clear, schema=_DELIVERY_SCHEMA
    )
    hass.services.async_register(DOMAIN, SERVICE_REPORT, report)
    hass.services.async_register(DOMAIN, SERVICE_COMMAND, command)


async def async_unload_services(hass: HomeAssistant) -> None:
    """Remove the services owned by this integration."""
    for service in (
        SERVICE_SEND,
        SERVICE_CLEAR,
        SERVICE_REPORT,
        SERVICE_COMMAND,
    ):
        hass.services.async_remove(DOMAIN, service)
