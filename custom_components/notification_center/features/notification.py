"""Compose notification commands from content, targets, and capabilities."""

from __future__ import annotations

import logging
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any, Callable, Protocol

from pydantic import ConfigDict

from ..controller.lifecycle import FeatureBase
from ..delivery.mobile_app import (
    LegacyMobileAppResolution,
    resolve_legacy_mobile_app_services,
)
from ..delivery.targets import (
    GENERIC_NOTIFY_SERVICE,
    GENERIC_NOTIFY_TARGET_KEYS,
    DeliveryType,
    RegistrySnapshot,
    classify_delivery_type,
    notification_services_for_target,
    resolve_target_devices,
    resolve_user_notification_target,
    target_values,
)
from ..domain.durations import parse_duration
from ..domain.service_calls import ServiceCall
from ..domain.template_values import (
    TemplateRenderer,
    remove_nulls,
    render_template_values,
)
from .confirmation import ConfirmationConfig, confirmation_for_alert
from .feature_config import AlertFeatureConfig

_LOGGER = logging.getLogger(__name__)

HasService = Callable[[str, str], bool]


def _list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


class NotificationConfig(AlertFeatureConfig):
    """Validated notification settings owned by the notification feature."""

    model_config = ConfigDict(extra="allow")

    target: dict[str, list[str]] | None = None
    title: str | None = None
    message: str | None = None
    data: dict[str, Any] | None = None


class NotificationSchedule:
    """Own condition-check and confirmation resend policy."""

    def __init__(
        self,
        notification: NotificationConfig,
        confirmation: ConfirmationConfig | None = None,
    ) -> None:
        self._notification = notification
        self._confirmation = confirmation

    def check_interval(self, monitor_interval: int | float | None) -> timedelta | None:
        """Return the configured condition-monitoring cadence."""

        if monitor_interval is None:
            return None
        return parse_duration(monitor_interval)

    def confirmation_interval(self) -> timedelta | None:
        """Return the cadence for pending confirmation reminders."""

        confirmation = self._confirmation
        if (
            not confirmation
            or not confirmation.enabled
            or not confirmation.reminders.enabled
        ):
            return None
        return parse_duration(confirmation.reminders.interval)

    def is_due(self, state: dict[str, Any], now: datetime) -> bool:
        """Return whether a pending confirmation resend is now due."""
        confirmation = self._confirmation
        if (
            not state.get("confirmation_action_id")
            or not confirmation
            or not confirmation.enabled
            or not confirmation.reminders.enabled
        ):
            return False

        interval = confirmation.reminders.interval
        max_attempts = confirmation.reminders.max_attempts
        if int(state.get("attempts", 0)) >= int(max_attempts or 1):
            return False
        last_notified = state.get("last_notified")
        if not last_notified:
            return True
        try:
            previous = datetime.fromisoformat(str(last_notified))
        except ValueError:
            return True
        duration = parse_duration(interval)
        return duration is None or now - previous >= duration


@dataclass(frozen=True)
class ConfirmationDeliveryPlan:
    """The notification work requested by a resolved confirmation."""

    clear_notification: bool
    completion_alert: dict[str, Any] | None


class ConfirmationDeliveryPlanner:
    """Build notification-only effects for one confirmed alert."""

    def __init__(
        self,
        alert: dict[str, Any],
        confirmed_by: str,
        now: Any,
    ) -> None:
        self.alert = alert
        self.confirmed_by = confirmed_by
        self.now = now
        self.notification = NotificationConfig.model_validate(alert["notification"])
        self.confirmation = confirmation_for_alert(alert)

    async def build(self, render: TemplateRenderer) -> ConfirmationDeliveryPlan:
        """Build clear and completion delivery requests without sending them."""

        confirmation = self.confirmation
        if confirmation is None:
            return ConfirmationDeliveryPlan(False, None)
        return ConfirmationDeliveryPlan(
            clear_notification=bool(confirmation.notification.clear),
            completion_alert=await self._completion_alert(render),
        )

    async def _completion_alert(
        self, render: TemplateRenderer
    ) -> dict[str, Any] | None:
        confirmation = self.confirmation
        if confirmation is None or not confirmation.notification.enabled:
            return None

        completion_message = (
            confirmation.notification.message
            or "{{ confirmed_by }} confirmed this notification."
        )
        completion_alert = deepcopy(self.alert)
        completion_alert["notification"] = self.notification.model_dump(
            exclude_none=True
        )
        completion_alert["notification"]["message"] = await render_template_values(
            completion_message,
            {
                "alert_id": self.alert["id"],
                "alert_name": self.alert["name"],
                "alert_active": True,
                "confirmed_by": self.confirmed_by,
                "now": self.now,
            },
            render,
        )
        completion_alert["confirmation"] = {"enabled": False}
        return completion_alert



class NotificationCapabilities(Protocol):
    """Home Assistant capabilities needed by notification workflows."""

    render: TemplateRenderer
    has_service: HasService
    snapshot: RegistrySnapshot


@dataclass(frozen=True)
class NotificationCapabilitySet:
    """Concrete capability values supplied by the controller."""

    render: TemplateRenderer
    has_service: HasService
    snapshot: RegistrySnapshot


class NotificationFeature(FeatureBase):
    """Own notification composition and Home Assistant delivery execution."""

    name = "notification"

    def capabilities(self) -> NotificationCapabilitySet:
        """Build the gateway values required for one delivery plan."""

        return NotificationCapabilitySet(
            render=self.services.gateway.render_template,
            has_service=self.services.gateway.has_service,
            snapshot=self.services.gateway.fetch_registry_snapshot(),
        )

    async def _execute(self, calls: list[ServiceCall]) -> None:
        for call in calls:
            await self.services.gateway.call_service(
                call.domain, call.service, call.data, call.target
            )

    async def send(self, payload: dict[str, Any]) -> bool:
        """Plan and execute a notification request."""

        calls = await send_requested(
            {**payload, "propagate_errors": True}, self.capabilities()
        )
        await self._execute(calls)
        return True

    async def clear(self, alert: dict[str, Any], now: Any) -> None:
        """Plan and best-effort execute a notification clear request."""

        calls = await clear_requested(
            {"alert": alert, "now": now}, self.capabilities()
        )
        try:
            await self._execute(calls)
        except Exception:
            _LOGGER.exception(
                "Failed clearing notification before deleting %s", alert["id"]
            )


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
    confirmation: ConfirmationConfig | None
    has_user_recipients: bool


# ----------------------------------------------------------------------
# Public entry points
# ----------------------------------------------------------------------


async def plan_delivery(
    alert: dict[str, Any],
    variables: dict[str, Any],
    confirmation_action_id: str | None,
    snapshot: RegistrySnapshot,
    render: TemplateRenderer,
    has_service: HasService,
) -> list[ServiceCall]:
    """Build the Home Assistant service calls that send one notification."""

    notification = NotificationConfig.model_validate(alert["notification"])
    rendered = await _render_notification(
        notification,
        confirmation_for_alert(alert),
        variables,
        render,
        snapshot,
    )
    has_confirmation = bool(
        confirmation_action_id
        and rendered.confirmation
        and rendered.confirmation.enabled
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
        if route_name in (NotificationRoute.LEGACY_MOBILE_APP,)
        else rendered.target
    )

    commands: list[ServiceCall] = []
    for action_to_call in actions_to_call:
        if "." not in action_to_call:
            raise ValueError(f"Invalid notification action: {action_to_call}")
        domain, service = action_to_call.split(".", 1)
        commands.append(
            ServiceCall(
                domain=domain,
                service=service,
                data=service_data,
                target=target,
            )
        )

    return commands


async def plan_clear(
    alert: dict[str, Any],
    variables: dict[str, Any],
    snapshot: RegistrySnapshot,
    render: TemplateRenderer,
    has_service: HasService,
) -> list[ServiceCall]:
    """Build the Home Assistant service calls that clear one notification."""

    notification = NotificationConfig.model_validate(alert["notification"])
    target = await render_template_values(notification.target, variables, render)
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

    commands: list[ServiceCall] = []
    for action_to_call in actions_to_call:
        domain, service = action_to_call.split(".", 1)
        commands.append(
            ServiceCall(
                domain=domain,
                service=service,
                data={
                    "message": "clear_notification",
                    "data": {"tag": f"notification_center_{alert['id']}"},
                },
                target=clear_target,
            )
        )

    return commands


async def _render_notification(
    notification: dict[str, Any],
    confirmation: ConfirmationConfig | None,
    variables: dict[str, Any],
    render: TemplateRenderer,
    snapshot: RegistrySnapshot,
) -> _RenderedNotification:
    notification = NotificationConfig.model_validate(notification)
    title = await render_template_values(notification.title, variables, render)
    message = await render_template_values(notification.message, variables, render)
    if (
        confirmation
        and confirmation.reminders.show_attempts
        and isinstance(title, str)
        and int(variables.get("attempt", 1)) > 1
    ):
        title = (
            f"{title} ({variables['attempt']}/"
            f"{confirmation.reminders.max_attempts or 1})"
        )
    target = await render_template_values(notification.target, variables, render)
    target, has_user_recipients = resolve_user_notification_target(snapshot, target)
    extra_data = await render_template_values(
        notification.data or {}, variables, render
    )

    return _RenderedNotification(
        title,
        message,
        target,
        _normalized_extra_data(extra_data),
        confirmation,
        has_user_recipients,
    )


def _normalized_extra_data(extra_data: Any) -> dict[str, Any]:
    if not isinstance(extra_data, dict):
        return {}
    return remove_nulls(deepcopy(extra_data))


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
        return NotificationRoute.GENERIC_NOTIFY, [f"notify.{GENERIC_NOTIFY_SERVICE}"]

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
# Typed workflow
# ----------------------------------------------------------------------


async def send_requested(
    payload: dict[str, Any], capabilities: NotificationCapabilities
) -> list[ServiceCall]:
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

    render = capabilities.render
    has_service = capabilities.has_service
    snapshot = capabilities.snapshot

    commands: list[ServiceCall] = []
    if payload.get("replace_existing"):
        commands.extend(
            await _clear_commands(alert, now, snapshot, render, has_service)
        )

    try:
        send_commands = await plan_delivery(
            alert, variables, confirmation_action_id, snapshot, render, has_service
        )
    except Exception:  # noqa: BLE001 - reported as an event, not re-raised
        if payload.get("propagate_errors", False):
            raise

        return commands

    commands.extend(send_commands)
    return commands


async def clear_requested(
    payload: dict[str, Any], capabilities: NotificationCapabilities
) -> list[ServiceCall]:
    alert = payload["alert"]
    now = payload.get("now")

    return await _clear_commands(
        alert,
        now,
        capabilities.snapshot,
        capabilities.render,
        capabilities.has_service,
    )


async def _clear_commands(
    alert: dict[str, Any],
    now: Any,
    snapshot: RegistrySnapshot,
    render: TemplateRenderer,
    has_service: HasService,
) -> list[ServiceCall]:
    variables = {"alert_id": alert["id"], "alert_name": alert["name"], "now": now}
    try:
        commands = await plan_clear(alert, variables, snapshot, render, has_service)
    except Exception:
        _LOGGER.exception("Failed clearing notification for %s", alert["id"])
        return []

    return commands


def _validate_confirmation_delivery(
    alert_id: str,
    has_confirmation: bool,
    route_name: str,
    legacy: LegacyMobileAppResolution,
    snapshot: RegistrySnapshot,
    target: dict[str, Any],
    has_service: HasService,
) -> None:
    if has_confirmation and route_name not in (NotificationRoute.LEGACY_MOBILE_APP,):
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
        if rendered.confirmation is None:
            raise ValueError("Confirmation configuration is required.")
        actions = list(extra_data.get("actions", []))
        actions.append(
            {
                "action": confirmation_action_id,
                "title": rendered.confirmation.button or "Done",
            }
        )
        extra_data["actions"] = actions

    service_data: dict[str, Any] = {"message": str(rendered.message)}
    if rendered.title:
        service_data["title"] = str(rendered.title)
    if extra_data:
        service_data["data"] = extra_data

    return remove_nulls(service_data)


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
