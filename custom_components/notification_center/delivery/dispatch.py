"""Notification dispatch through Home Assistant services."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import Context, HomeAssistant
from homeassistant.util import dt as dt_util

from .mobile_app import legacy_mobile_app_services_for_target
from .planning import (
    notification_delivery_plan,
    service_data_for_notification,
    validate_confirmation_delivery,
)
from .recipients import (
    notification_registry_snapshot,
    notification_services_for_target,
    resolve_target_devices,
)
from .rendering import async_render_notification, render_value
from .types import NotificationDeliveryPlan

_LOGGER = logging.getLogger(f"{__package__}.notifications")


class NotificationDispatcher:
    """Send notifications through Home Assistant."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def async_send(
        self,
        alert: dict[str, Any],
        *,
        attempt: int,
        confirmation_action_id: str | None,
        context: Context | None,
        test: bool = False,
    ) -> None:
        """Send one alert notification."""

        notification = alert["notification"]
        registries = notification_registry_snapshot(self.hass)
        variables = {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "attempt": attempt,
            "test": test,
            "now": dt_util.now(),
            "notification_id": f"notification_center_{alert['id']}",
            "confirmation_action_id": confirmation_action_id,
        }
        rendered = await async_render_notification(
            self.hass,
            notification,
            variables,
            registries,
        )
        has_confirmation = bool(
            confirmation_action_id and rendered.confirmation.get("enabled", False)
        )
        plan = notification_delivery_plan(registries, rendered)
        _LOGGER.debug(
            "Notification delivery plan alert_id=%s requested=%s "
            "resolved_devices=%d candidate_legacy_services=%s",
            alert["id"],
            plan.requested_counts,
            len(plan.legacy_resolution.device_ids),
            plan.legacy_resolution.services,
        )
        validate_confirmation_delivery(alert["id"], has_confirmation, plan)
        _LOGGER.info(
            "Notification delivery alert_id=%s route=%s recipients=%d",
            alert["id"],
            plan.route,
            len(plan.actions_to_call),
        )
        await async_dispatch_notification(
            self.hass,
            plan,
            service_data_for_notification(
                rendered,
                confirmation_action_id,
                has_confirmation,
            ),
            rendered.action,
            rendered.extra_data,
            context,
        )

    async def async_clear(
        self,
        alert: dict[str, Any],
        *,
        context: Context | None,
    ) -> None:
        """Clear a notification when the target service supports clearing."""

        notification = alert["notification"]
        action = str(notification.get("action") or "")
        registries = notification_registry_snapshot(self.hass)
        target = await render_value(
            self.hass,
            notification.get("target", {}),
            {
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "now": dt_util.now(),
            },
        )
        target_resolution = resolve_target_devices(
            target,
            registries.area_registry,
            registries.device_registry,
        )
        resolved_actions = notification_services_for_target(
            registries,
            target,
            target_resolution,
        )
        legacy_resolution = legacy_mobile_app_services_for_target(
            registries,
            target,
            resolved_actions,
            target_resolution.device_ids,
        )
        actions_to_call = (
            [f"notify.{service}" for service in legacy_resolution.services]
            if legacy_resolution.services
            else [action]
            if action.startswith("notify.")
            else []
        )

        for action_to_call in actions_to_call:
            domain, service = action_to_call.split(".", 1)
            await self.hass.services.async_call(
                domain,
                service,
                service_data={
                    "message": "clear_notification",
                    "data": {"tag": f"notification_center_{alert['id']}"},
                },
                target=None
                if legacy_resolution.services
                else target
                if target
                else None,
                blocking=True,
                context=context,
            )


async def async_dispatch_notification(
    hass: HomeAssistant,
    plan: NotificationDeliveryPlan,
    service_data: dict[str, Any],
    action: str,
    extra_data: dict[str, Any],
    context: Context | None,
) -> None:
    """Call the Home Assistant notify service for a delivery plan."""

    if action and "." not in action:
        raise ValueError(f"Invalid notification action: {action}")

    for action_to_call in plan.actions_to_call:
        if "." not in action_to_call:
            raise ValueError(f"Invalid notification action: {action_to_call}")

        domain, service = action_to_call.split(".", 1)
        try:
            await hass.services.async_call(
                domain,
                service,
                service_data=service_data,
                target=None
                if plan.route in ("legacy_mobile_app", "explicit_legacy_mobile_app")
                else plan.target,
                blocking=True,
                context=context,
            )
        except Exception as err:
            detail = str(err)
            if action_to_call == "notify.send_message" and extra_data:
                detail = (
                    f"{detail} The selected notification recipient does not accept "
                    "notification data such as confirmation actions."
                )
            raise RuntimeError(
                f"Notification service {action_to_call} rejected the payload: {detail}"
            ) from err