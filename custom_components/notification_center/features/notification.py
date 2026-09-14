"""Compose notification commands from content, targets, and capabilities."""

from __future__ import annotations

import logging
from copy import deepcopy
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Callable

from ..controller import events as ev
from ..controller.commands import CallService, Command, Emit, RunBatch
from ..controller.events import Event
from .notification_services import (
    GENERIC_NOTIFY_SERVICE,
    GENERIC_NOTIFY_TARGET_KEYS,
    DeliveryType,
    LegacyMobileAppResolution,
    RegistrySnapshot,
    classify_delivery_type,
    notification_services_for_target,
    resolve_legacy_mobile_app_services,
    resolve_target_devices,
    resolve_user_notification_target,
    target_values,
)
from .rendering import Render, remove_none, render_value

_LOGGER = logging.getLogger(__name__)

HasService = Callable[[str, str], bool]


class NotificationRoute(StrEnum):
    """How a notification was resolved to concrete notify service calls."""

    LEGACY_MOBILE_APP = "legacy_mobile_app"
    GENERIC_NOTIFY = "generic_notify"


# ----------------------------------------------------------------------
# Plain data
# ----------------------------------------------------------------------


@dataclass
class _RenderedNotification:
    title: Any
    message: Any
    target: dict[str, Any]
    extra_data: dict[str, Any]
    confirmation: Any
    has_user_recipients: bool


# ----------------------------------------------------------------------
# Public entry points
# ----------------------------------------------------------------------


async def compose_send(
    alert: dict[str, Any],
    variables: dict[str, Any],
    confirmation_action_id: str | None,
    snapshot: RegistrySnapshot,
    render: Render,
    has_service: HasService,
) -> list[Command]:
    """Build the Home Assistant service calls that send one notification."""

    notification = alert["notification"]
    rendered = await _render_notification(notification, variables, render, snapshot)
    has_confirmation = bool(
        confirmation_action_id and rendered.confirmation.get("enabled", False)
    )

    resolution = resolve_target_devices(rendered.target, snapshot)
    resolved_actions = notification_services_for_target(
        snapshot, rendered.target, resolution
    )
    legacy = resolve_legacy_mobile_app_services(
        snapshot, resolved_actions, resolution.device_ids, has_service
    )
    requested_counts = _requested_target_counts(rendered.target)
    recipient_summary = _recipient_resolution_summary(
        snapshot, rendered.target, has_service
    )
    route_name, actions_to_call = _notification_route(
        snapshot,
        rendered,
        legacy.services,
        "Invalid:" in recipient_summary,
        has_service,
    )

    _log_plan(alert["id"], route_name, actions_to_call, requested_counts, legacy)
    _validate_confirmation_delivery(
        alert["id"],
        has_confirmation,
        route_name,
        legacy,
        snapshot,
        rendered.target,
        has_service,
    )

    service_data = _service_data_for_notification(
        rendered, confirmation_action_id, has_confirmation
    )
    target = (
        None
        if route_name in (
            NotificationRoute.LEGACY_MOBILE_APP,
        )
        else rendered.target
    )

    commands: list[Command] = []
    for action_to_call in actions_to_call:
        if "." not in action_to_call:
            raise ValueError(f"Invalid notification action: {action_to_call}")
        domain, service = action_to_call.split(".", 1)
        commands.append(CallService(domain, service, service_data, target))

    return commands


async def compose_clear(
    alert: dict[str, Any],
    variables: dict[str, Any],
    snapshot: RegistrySnapshot,
    render: Render,
    has_service: HasService,
) -> list[Command]:
    """Build the Home Assistant service calls that clear one notification."""

    notification = alert["notification"]
    target = await render_value(render, notification.get("target", {}), variables)
    if not isinstance(target, dict):
        target = {}

    resolution = resolve_target_devices(target, snapshot)
    resolved_actions = notification_services_for_target(snapshot, target, resolution)
    legacy = resolve_legacy_mobile_app_services(
        snapshot, resolved_actions, resolution.device_ids, has_service
    )
    if legacy.services:
        actions_to_call = [f"notify.{service}" for service in legacy.services]
        clear_target = None
    elif target:
        actions_to_call = [f"notify.{GENERIC_NOTIFY_SERVICE}"]
        clear_target = target
    else:
        actions_to_call = []
        clear_target = target or None

    commands: list[Command] = []
    for action_to_call in actions_to_call:
        domain, service = action_to_call.split(".", 1)
        commands.append(
            CallService(
                domain,
                service,
                {
                    "message": "clear_notification",
                    "data": {"tag": f"notification_center_{alert['id']}"},
                },
                clear_target,
            )
        )

    return commands


async def _render_notification(
    notification: dict[str, Any],
    variables: dict[str, Any],
    render: Render,
    snapshot: RegistrySnapshot,
) -> _RenderedNotification:
    title = await render_value(render, notification.get("title", ""), variables)
    message = await render_value(render, notification.get("message", ""), variables)
    target = await render_value(render, notification.get("target", {}), variables)
    target, has_user_recipients = resolve_user_notification_target(snapshot, target)
    extra_data = await render_value(render, notification.get("data", {}), variables)

    return _RenderedNotification(
        title,
        message,
        target,
        _normalized_extra_data(extra_data),
        notification.get("confirmation", {}),
        has_user_recipients,
    )


def _normalized_extra_data(extra_data: Any) -> dict[str, Any]:
    if not isinstance(extra_data, dict):
        return {}
    return remove_none(deepcopy(extra_data))


# ----------------------------------------------------------------------
# Route planning
# ----------------------------------------------------------------------


def _notification_route(
    snapshot: RegistrySnapshot,
    rendered: _RenderedNotification,
    legacy_services: list[str],
    has_unresolved_recipients: bool,
    has_service: HasService,
) -> tuple[str, list[str]]:
    delivery_type = classify_delivery_type(
        rendered.target,
        rendered.has_user_recipients,
        bool(legacy_services),
        has_unresolved_recipients,
    )
    if delivery_type == DeliveryType.LEGACY_MOBILE_APP:
        return NotificationRoute.LEGACY_MOBILE_APP, [
            f"notify.{service}" for service in legacy_services
        ]

    if delivery_type == DeliveryType.GENERIC_NOTIFY:
        return NotificationRoute.GENERIC_NOTIFY, [
            f"notify.{GENERIC_NOTIFY_SERVICE}"
        ]

    raise ValueError(
        "No valid notify service was found for the selected recipients. "
        + _recipient_resolution_summary(snapshot, rendered.target, has_service)
    )


def _recipient_resolution_summary(
    snapshot: RegistrySnapshot,
    target: dict[str, Any],
    has_service: HasService,
) -> str:
    """Explain which selected recipients can resolve to a direct service."""

    valid: list[str] = []
    invalid: list[str] = []
    entity_services = {
        entity.entity_id
        for entity in snapshot.entity_registry.entities.values()
        if entity.entity_id.startswith("notify.")
    }

    for key in GENERIC_NOTIFY_TARGET_KEYS:
        for value in target_values(target, key):
            label = _recipient_label(snapshot, key, value)
            if key == "entity_id" and value not in entity_services:
                invalid.append(f"{label} (notification entity not found)")
                continue

            recipient_target = {key: [value]}
            recipient_resolution = resolve_target_devices(recipient_target, snapshot)
            candidate_actions = notification_services_for_target(
                snapshot, recipient_target, recipient_resolution
            )
            candidate_legacy = resolve_legacy_mobile_app_services(
                snapshot,
                candidate_actions,
                recipient_resolution.device_ids,
                has_service,
            )
            if not candidate_actions:
                invalid.append(f"{label} (no notification-capable device found)")
                continue
            if candidate_legacy.services:
                valid.append(f"{label} (direct Mobile App service available)")
            else:
                invalid.append(f"{label} (Mobile App notify service is not registered)")

    if valid and invalid:
        return "Valid: " + "; ".join(valid) + ". Invalid: " + "; ".join(invalid) + "."
    if invalid:
        return "Invalid: " + "; ".join(invalid) + "."
    return "No recipient details were available."


def _recipient_label(snapshot: RegistrySnapshot, key: str, value: str) -> str:
    registry_map = {
        "device_id": snapshot.device_registry.devices,
        "area_id": snapshot.area_registry.areas,
    }
    item = registry_map.get(key, {}).get(value)
    name = getattr(item, "name_by_user", None) or getattr(item, "name", None)
    return f"{key} '{name or value}'"


def _requested_target_counts(target: dict[str, Any]) -> dict[str, int]:
    return {
        key: len(target_values(target, key))
        for key in GENERIC_NOTIFY_TARGET_KEYS + ("user_id",)
        if target_values(target, key)
    }


# ----------------------------------------------------------------------
# Event-bus adapter - the only impure part of this module
# ----------------------------------------------------------------------


def register(bus: Any) -> None:
    """Subscribe this module's reactions to the events it owns."""

    bus.subscribe(ev.NOTIFICATION_SEND_REQUESTED, handle_send_requested)
    bus.subscribe(ev.NOTIFICATION_CLEAR_REQUESTED, handle_clear_requested)


async def handle_send_requested(event: Any, bus: Any) -> list[Command]:
    payload = event.payload
    alert = payload["alert"]
    now = payload["now"]
    confirmation_action_id = payload.get("confirmation_action_id")

    variables = {
        "alert_id": alert["id"],
        "alert_name": alert["name"],
        "alert_active": True,
        "attempt": payload["attempt"],
        "test": payload.get("test", False),
        "now": now,
        "notification_id": f"notification_center_{alert['id']}",
        "confirmation_action_id": confirmation_action_id,
    }

    render = await bus.ask(ev.RENDER_TEMPLATE)
    has_service = await bus.ask(ev.HAS_SERVICE)
    snapshot = await bus.ask(ev.FETCH_REGISTRY_SNAPSHOT)

    commands: list[Command] = []
    if payload.get("replace_existing"):
        commands.extend(
            await _clear_commands(alert, now, snapshot, render, has_service)
        )

    try:
        send_commands = await compose_send(
            alert, variables, confirmation_action_id, snapshot, render, has_service
        )
    except Exception as err:  # noqa: BLE001 - reported as an event, not re-raised
        if payload.get("propagate_errors", False):
            raise

        on_failed = payload.get("on_failed")
        if on_failed is not None:
            failed_payload = dict(on_failed.payload)
            failed_payload["error"] = str(err)
            commands.append(Emit(Event(on_failed.type, failed_payload)))
        return commands

    if payload.get("propagate_errors", False):
        commands.extend(send_commands)
        if payload.get("on_sent") is not None:
            commands.append(Emit(payload["on_sent"]))
        return commands

    commands.append(
        RunBatch(
            send_commands,
            on_success=payload.get("on_sent"),
            on_error=payload.get("on_failed"),
        )
    )
    return commands


async def handle_clear_requested(event: Any, bus: Any) -> list[Command]:
    payload = event.payload
    alert = payload["alert"]
    now = payload.get("now")

    render = await bus.ask(ev.RENDER_TEMPLATE)
    has_service = await bus.ask(ev.HAS_SERVICE)
    snapshot = await bus.ask(ev.FETCH_REGISTRY_SNAPSHOT)

    return await _clear_commands(alert, now, snapshot, render, has_service)


async def _clear_commands(
    alert: dict[str, Any],
    now: Any,
    snapshot: RegistrySnapshot,
    render: Render,
    has_service: HasService,
) -> list[Command]:
    variables = {"alert_id": alert["id"], "alert_name": alert["name"], "now": now}
    try:
        commands = await compose_clear(alert, variables, snapshot, render, has_service)
    except Exception:
        _LOGGER.exception("Failed clearing notification for %s", alert["id"])
        return []

    return [RunBatch(commands)] if commands else []


def _validate_confirmation_delivery(
    alert_id: str,
    has_confirmation: bool,
    route_name: str,
    legacy: LegacyMobileAppResolution,
    snapshot: RegistrySnapshot,
    target: dict[str, Any],
    has_service: HasService,
) -> None:
    if has_confirmation and route_name not in (
        NotificationRoute.LEGACY_MOBILE_APP,
    ):
        raise ValueError(
            "Confirmation buttons require a resolved Mobile App direct service; "
            f"resolved devices: {len(legacy.device_ids)}, services: "
            f"{len(legacy.services)}. "
            + _recipient_resolution_summary(snapshot, target, has_service)
        )


def _service_data_for_notification(
    rendered: _RenderedNotification,
    confirmation_action_id: str | None,
    has_confirmation: bool,
) -> dict[str, Any]:
    extra_data = rendered.extra_data
    if has_confirmation:
        actions = list(extra_data.get("actions", []))
        actions.append(
            {
                "action": confirmation_action_id,
                "title": rendered.confirmation.get("button", "Done") or "Done",
            }
        )
        extra_data["actions"] = actions

    service_data: dict[str, Any] = {"message": str(rendered.message)}
    if rendered.title:
        service_data["title"] = str(rendered.title)
    if extra_data:
        service_data["data"] = extra_data

    return remove_none(service_data)


def _log_plan(
    alert_id: str,
    route_name: str,
    actions_to_call: list[str],
    requested_counts: dict[str, int],
    legacy: LegacyMobileAppResolution,
) -> None:
    _LOGGER.debug(
        "Notification delivery plan alert_id=%s requested=%s "
        "resolved_devices=%d candidate_legacy_services=%s",
        alert_id,
        requested_counts,
        len(legacy.device_ids),
        legacy.services,
    )
    _LOGGER.info(
        "Notification delivery alert_id=%s route=%s recipients=%d",
        alert_id,
        route_name,
        len(actions_to_call),
    )
