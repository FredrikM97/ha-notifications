"""Notification delivery route planning."""

from __future__ import annotations

import logging
from typing import Any

from .mobile_app import legacy_mobile_app_services_for_target
from .recipients import (
    GENERIC_NOTIFY_TARGET_KEYS,
    notification_services_for_target,
    resolve_target_devices,
    target_values,
)
from .types import (
    NotificationDeliveryPlan,
    NotificationRegistrySnapshot,
    RenderedNotification,
)

_LOGGER = logging.getLogger(f"{__package__}.notifications")


def notification_delivery_plan(
    registries: NotificationRegistrySnapshot,
    rendered: RenderedNotification,
) -> NotificationDeliveryPlan:
    """Build the Home Assistant service call plan for a rendered notification."""

    target_resolution = resolve_target_devices(
        rendered.target,
        registries.area_registry,
        registries.device_registry,
    )
    resolved_actions = notification_services_for_target(
        registries,
        rendered.target,
        target_resolution,
    )
    legacy_resolution = legacy_mobile_app_services_for_target(
        registries,
        rendered.target,
        resolved_actions,
        target_resolution.device_ids,
    )
    requested_counts = {
        key: len(target_values(rendered.target, key))
        for key in GENERIC_NOTIFY_TARGET_KEYS + ("user_id",)
        if target_values(rendered.target, key)
    }
    has_target = any(
        values for values in rendered.target.values() if isinstance(values, (str, list))
    )
    explicit_legacy_action = rendered.action.startswith(
        "notify.mobile_app_"
    ) and registries.hass.services.has_service(
        "notify", rendered.action.split(".", 1)[1]
    )

    if legacy_resolution.services:
        actions_to_call, route = (
            [f"notify.{service}" for service in legacy_resolution.services],
            "legacy_mobile_app",
        )
    elif explicit_legacy_action:
        actions_to_call, route = [rendered.action], "explicit_legacy_mobile_app"
    elif (
        rendered.action == "notify.send_message"
        or rendered.has_user_recipients
        or has_target
    ):
        actions_to_call, route = ["notify.send_message"], "generic_notify"
    elif rendered.action:
        actions_to_call, route = [rendered.action], "explicit_action"
    else:
        raise ValueError(
            "No valid notify service was found for the selected recipients."
        )

    return NotificationDeliveryPlan(
        actions_to_call,
        route,
        rendered.target,
        legacy_resolution,
        requested_counts,
    )


def validate_confirmation_delivery(
    alert_id: str,
    has_confirmation: bool,
    plan: NotificationDeliveryPlan,
) -> None:
    """Reject confirmation buttons when the delivery route cannot support them."""

    if has_confirmation and plan.route not in (
        "legacy_mobile_app",
        "explicit_legacy_mobile_app",
    ):
        _LOGGER.warning(
            "Confirmation delivery unavailable alert_id=%s requested=%s "
            "resolved_devices=%d candidate_legacy_services=%s route=%s",
            alert_id,
            plan.requested_counts,
            len(plan.legacy_resolution.device_ids),
            plan.legacy_resolution.services,
            plan.route,
        )
        raise ValueError(
            "Confirmation buttons require a resolved Mobile App direct service; "
            "resolved devices: "
            f"{len(plan.legacy_resolution.device_ids)}, services: "
            f"{len(plan.legacy_resolution.services)}."
        )


def service_data_for_notification(
    rendered: RenderedNotification,
    confirmation_action_id: str | None,
    has_confirmation: bool,
) -> dict[str, Any]:
    """Build Home Assistant service data for one rendered notification."""

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

    service_data = {"message": str(rendered.message)}
    if rendered.title:
        service_data["title"] = str(rendered.title)
    if extra_data:
        service_data["data"] = extra_data

    from .rendering import remove_none

    return remove_none(service_data)