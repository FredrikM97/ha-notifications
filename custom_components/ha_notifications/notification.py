"""Minimal delivery services for generated Home Assistant automations."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.template import Template

from .const import (
    DOMAIN,
    SERVICE_CLEAR,
    SERVICE_RECORD,
    SERVICE_REPORT,
    SERVICE_SEND,
)
from .domain import AutomationRunTracker
from .history import history_store
from .mobile_app import resolve_services
from .targets import resolve_target


def _entry(hass: HomeAssistant) -> Any:
    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        raise HomeAssistantError("HA Notifications has no config entry")
    return entries[0]


async def _async_send(hass: HomeAssistant, call: ServiceCall) -> None:
    await _deliver(hass, call, False)


async def _async_clear(hass: HomeAssistant, call: ServiceCall) -> None:
    await _deliver(hass, call, True)


async def _async_record(hass: HomeAssistant, call: ServiceCall) -> None:
    """Record a successful native automation action."""
    alert_id = call.data.get("alert_id")
    if not isinstance(alert_id, str) or not alert_id:
        raise HomeAssistantError("ha_notifications.record requires alert_id")
    kwargs = {}
    flow_id = call.data.get("flow_id") or call.data.get("run_id")
    if isinstance(flow_id, str) and flow_id:
        kwargs["flow_id"] = flow_id
    await history_store(_entry(hass)).async_record(
        alert_id,
        str(call.data.get("alert_name", alert_id)),
        str(call.data.get("event_type", "action_executed")),
        str(call.data.get("message", "Automation action executed")),
        call.data.get("details") if isinstance(call.data.get("details"), dict) else {},
        **kwargs,
    )


def _run_tracker(hass: HomeAssistant) -> AutomationRunTracker | None:
    entry = _entry(hass)
    tracker = getattr(getattr(entry, "runtime_data", None), "automation_runs", None)
    return tracker if isinstance(tracker, AutomationRunTracker) else None


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
    notification: dict[str, Any],
) -> dict[str, Any]:
    """Render deferred confirmation templates in the managed send service."""
    data = dict(notification.get("data", {}))
    template_message = data.pop("template_message", None)
    device_id = data.pop("confirmation_device_id", None)
    user_id = data.pop("confirmation_user_id", None)
    if isinstance(template_message, str):
        details = {"device_id": device_id, "user_id": user_id}
        variables = {
            "confirmed_by": await _confirmed_by(hass, details),
            "user_id": user_id or "",
            "alert_id": notification.get("alert_id"),
            "alert_name": notification.get("alert_name"),
        }
        rendered = Template(template_message, hass).async_render(
            variables, parse_result=False
        )
        data["message"] = str(rendered)
    if data:
        notification["data"] = data
    else:
        notification.pop("data", None)
    return notification


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
    if status == "inactive":
        tracker = _run_tracker(hass)
        if tracker is not None:
            tracker.cleared(alert_id)
    elif status == "started" or status.endswith("_completed") or status in {
        "waiting",
        "running",
    }:
        if not isinstance(run_id, str) or not run_id:
            raise HomeAssistantError(
                f"ha_notifications.report status {status!r} requires run_id"
            )
        tracker = _run_tracker(hass)
        if tracker is not None:
            if status == "started":
                tracker.started(alert_id, run_id)
            elif status.endswith("_completed"):
                tracker.completed(alert_id, run_id)
            else:
                tracker.phase(alert_id, run_id, status)
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
    await history_store(_entry(hass)).async_record(
        alert_id,
        str(call.data.get("alert_name", alert_id)),
        status,
        str(call.data.get("message", status.replace("_", " ").title())),
        details,
        **kwargs,
    )


def _parse_notification(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise HomeAssistantError("notification must be a mapping")
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
            f"ha_notifications.{service_name} requires a notification target"
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
    notification: dict[str, Any], clear: bool, alert_id: str | None
) -> dict[str, Any]:
    notification_data = dict(notification.get("data", {}))
    actions = notification_data.pop("actions", None)
    message = notification.get("message") or notification_data.pop("message", None)
    title = notification.get("title") or notification_data.pop("title", None)
    payload: dict[str, Any] = {}
    if title:
        payload["title"] = title
    if message:
        payload["message"] = message
    if notification.get("action") and isinstance(notification.get("target"), dict):
        payload.update(notification["target"])
    if alert_id:
        notification_data.setdefault("tag", alert_id)
    if notification_data:
        payload["data"] = notification_data
    if actions is not None:
        payload.setdefault("data", {})["actions"] = actions
    if clear:
        payload["message"] = "clear_notification"
    return payload


async def _deliver(hass: HomeAssistant, call: ServiceCall, clear: bool) -> None:
    notification = _parse_notification(call.data.get("notification", call.data))
    notification["alert_id"] = call.data.get("alert_id")
    notification["alert_name"] = call.data.get("alert_name")
    notification = await _render_confirmation_message(hass, notification)
    service_name = SERVICE_CLEAR if clear else SERVICE_SEND
    services = _target_services(hass, notification, service_name)
    payload = _payload(notification, clear, call.data.get("alert_id"))
    for action in services:
        domain, service = action.split(".")
        await hass.services.async_call(
            domain,
            service,
            service_data=payload,
            blocking=True,
            context=call.context,
        )
    alert_id = call.data.get("alert_id")
    if isinstance(alert_id, str) and alert_id:
        if clear:
            tracker = _run_tracker(hass)
            if tracker is not None:
                tracker.cleared(alert_id)
        kwargs = {}
        flow_id = call.data.get("flow_id") or call.data.get("run_id")
        if isinstance(flow_id, str) and flow_id:
            kwargs["flow_id"] = flow_id
        await history_store(_entry(hass)).async_record(
            alert_id,
            str(call.data.get("alert_name", alert_id)),
            "notification_cleared" if clear else "notification_sent",
            "Notification cleared" if clear else "Notification sent",
            {"service": services[0] if len(services) == 1 else services},
            **kwargs,
        )


async def async_setup_services(hass: HomeAssistant) -> None:
    """Register the two public delivery services."""
    async def send(call: ServiceCall) -> None:
        await _deliver(hass, call, False)

    async def clear(call: ServiceCall) -> None:
        await _async_clear(hass, call)

    async def record(call: ServiceCall) -> None:
        await _async_record(hass, call)

    async def report(call: ServiceCall) -> None:
        await _async_report(hass, call)

    hass.services.async_register(
        DOMAIN, SERVICE_SEND, send
    )
    hass.services.async_register(
        DOMAIN, SERVICE_CLEAR, clear
    )
    hass.services.async_register(
        DOMAIN, SERVICE_RECORD, record
    )
    hass.services.async_register(DOMAIN, SERVICE_REPORT, report)


async def async_unload_services(hass: HomeAssistant) -> None:
    """Remove the services owned by this integration."""
    for service in (
        SERVICE_SEND,
        SERVICE_CLEAR,
        SERVICE_RECORD,
        SERVICE_REPORT,
    ):
        hass.services.async_remove(DOMAIN, service)
