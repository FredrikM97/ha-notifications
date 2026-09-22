"""Compose notification commands from content, targets, and capabilities."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pydantic import BaseModel, ConfigDict

from ..controller.lifecycle import FeatureBase
from ..delivery.targets import (
    GENERIC_NOTIFY_SERVICE,
    GENERIC_NOTIFY_TARGET_KEYS,
    RegistrySnapshot,
    mobile_app_notify_services_for_target,
    resolve_user_notification_target,
    target_values,
)
from ..domain.confirmation import ConfirmationContext
from ..domain.service_calls import HomeAssistantServiceCall
from ..domain.workflow import (
    ConfirmationWorkflowEvent,
    NotificationClearRequest,
    NotificationOutcome,
    NotificationRequest,
)
from ..support.jinja import (
    JinjaEvaluator,
    TemplateRenderer,
    remove_nulls,
    render_values,
)
from .confirmations import ConfirmationConfig

_LOGGER = logging.getLogger(__name__)

class NotificationConfig(BaseModel):
    """Validated notification settings owned by the notification feature."""

    model_config = ConfigDict(extra="allow")

    target: dict[str, list[str]] | None = None
    title: str | None = None
    message: str | None = None
    data: dict[str, Any] | None = None


@dataclass(frozen=True)
class ConfirmationDeliveryPlan:
    """The notification work requested by a resolved confirmation."""

    clear_notification: bool
    completion_alert: dict[str, Any] | None


class ConfirmationDeliveryPlanner:
    """Build notification-only effects for one confirmed alert."""

    def __init__(
        self,
        alert: Mapping[str, Any],
        confirmation: ConfirmationContext,
        now: Any,
    ) -> None:
        self.alert = alert
        self.context = confirmation
        self.now = now
        self.notification = NotificationConfig.model_validate(alert["notification"])
        self.settings = ConfirmationConfig.from_alert(alert)

    async def build(self, render: TemplateRenderer) -> ConfirmationDeliveryPlan:
        """Build clear and completion delivery requests without sending them."""

        confirmation = self.settings
        if confirmation is None:
            return ConfirmationDeliveryPlan(False, None)
        return ConfirmationDeliveryPlan(
            clear_notification=bool(confirmation.notification.clear),
            completion_alert=await self._completion_alert(render),
        )

    async def _completion_alert(
        self, render: TemplateRenderer
    ) -> dict[str, Any] | None:
        confirmation = self.settings
        if confirmation is None or not confirmation.notification.enabled:
            return None

        completion_message = (
            confirmation.notification.message
            or "{{ request.confirmation.confirmed_by }} confirmed this notification."
        )
        completion_alert = deepcopy(dict(self.alert))
        completion_alert["notification"] = self.notification.model_dump(
            exclude_none=True
        )
        request = ConfirmationWorkflowEvent(
            self.alert, self.context, self.now
        )
        template_values = {
            "request": request,
            "confirmed_by": self.context.confirmed_by,
            "confirmation_response_id": self.context.selection.response_id,
            "confirmation_response": self.context.selection.label,
            "alert_id": self.alert.get("id"),
            "alert_name": self.alert.get("name"),
        }
        completion_alert["notification"]["message"] = await render_values(
            completion_message,
            template_values,
            render,
        )
        completion_alert["confirmation"] = {"enabled": False}
        return completion_alert



@dataclass(frozen=True)
class NotificationCapabilitySet:
    """Home Assistant values needed by notification delivery planning."""

    render: TemplateRenderer
    snapshot: RegistrySnapshot


class NotificationFeature(FeatureBase):
    """Own notification composition and Home Assistant delivery execution."""

    name = "notification"

    def __init__(
        self,
        hass: Any,
        _state: Any,
        _config_storage: Any,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._jinja = JinjaEvaluator.for_hass(hass)

    @staticmethod
    def should_clear_on_condition_change(
        alert: Mapping[str, Any],
    ) -> bool:
        """Decide whether a false condition clears its notification."""

        monitor = alert.get("monitor") or {}
        configured = monitor.get("clear_on_condition_change")
        if configured is not None:
            return bool(configured)
        confirmation = ConfirmationConfig.from_alert(alert)
        return confirmation is None or not bool(confirmation.enabled)

    def capabilities(self) -> NotificationCapabilitySet:
        """Build the Home Assistant values required for one delivery plan."""

        hass = self._hass
        mobile_app_entries = list(hass.config_entries.async_entries("mobile_app"))
        return NotificationCapabilitySet(
            render=self._jinja.render,
            snapshot=RegistrySnapshot(
                area_registry=ar.async_get(hass),
                device_registry=dr.async_get(hass),
                entity_registry=er.async_get(hass),
                mobile_app_entries=mobile_app_entries,
                person_states=list(hass.states.async_all("person")),
                has_service=hass.services.has_service,
            ),
        )

    async def _execute(self, calls: list[HomeAssistantServiceCall]) -> None:
        for call in calls:
            await self._hass.services.async_call(
                call.domain,
                call.service,
                service_data=call.data,
                target=call.target,
                blocking=True,
            )

    async def send(self, request: NotificationRequest) -> NotificationOutcome:
        """Plan and execute one typed notification request."""

        try:
            calls = await send_requested(
                request,
                self.capabilities(),
                propagate_errors=True,
            )
            await self._execute(calls)
        except Exception as err:
            return NotificationOutcome(request.attempt, request.now, False, str(err))
        return NotificationOutcome(request.attempt, request.now, True)

    async def clear(self, alert: Mapping[str, Any], now: Any) -> None:
        """Plan and best-effort execute a notification clear request."""

        request = NotificationClearRequest(alert, now)
        calls = await clear_requested(request, self.capabilities())
        try:
            await self._execute(calls)
        except Exception:
            _LOGGER.exception(
                "Failed clearing notification before deleting %s", alert["id"]
            )


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


# ----------------------------------------------------------------------
# Public entry points
# ----------------------------------------------------------------------


async def plan_delivery(
    request: NotificationRequest,
    snapshot: RegistrySnapshot,
    render: TemplateRenderer,
    notification_actions: list[dict[str, str]] | None = None,
) -> list[HomeAssistantServiceCall]:
    """Build the Home Assistant service calls that send one notification."""

    alert = request.alert
    notification = NotificationConfig.model_validate(alert["notification"])
    rendered = await _render_notification(
        notification,
        ConfirmationConfig.from_alert(alert),
        request,
        render,
        snapshot,
    )
    has_confirmation = bool(
        notification_actions
        and rendered.confirmation
        and rendered.confirmation.enabled
    )

    if not rendered.target:
        raise ValueError("At least one notification target is required.")

    requested_counts = _requested_target_counts(rendered.target)
    actions_to_call = [f"notify.{GENERIC_NOTIFY_SERVICE}"]
    target = rendered.target
    mobile_services = mobile_app_notify_services_for_target(rendered.target, snapshot)
    if mobile_services:
        actions_to_call = mobile_services
        target = None
    _log_plan(alert["id"], actions_to_call, requested_counts)

    service_data = _service_data_for_notification(
        rendered,
        has_confirmation,
        include_extra_data=bool(mobile_services),
        notification_id=f"ha_notifications_{alert['id']}",
        notification_actions=notification_actions,
    )
    commands: list[HomeAssistantServiceCall] = []
    for action_to_call in actions_to_call:
        if "." not in action_to_call:
            raise ValueError(f"Invalid notification action: {action_to_call}")
        domain, service = action_to_call.split(".", 1)
        commands.append(
            HomeAssistantServiceCall(
                domain=domain,
                service=service,
                data=service_data,
                target=target,
            )
        )

    return commands


async def plan_clear(
    request: NotificationClearRequest,
    snapshot: RegistrySnapshot,
    render: TemplateRenderer,
) -> list[HomeAssistantServiceCall]:
    """Build the Home Assistant service calls that clear one notification."""

    alert = request.alert
    notification = NotificationConfig.model_validate(alert["notification"])
    target = await render_values(notification.target, {"request": request}, render)
    target = resolve_user_notification_target(snapshot, target)
    if not target:
        return []

    actions_to_call = mobile_app_notify_services_for_target(target, snapshot)
    if not actions_to_call:
        _LOGGER.debug(
            "Skipping notification clear for %s: no Mobile App service resolved",
            alert["id"],
        )
        return []

    clear_target = None

    commands: list[HomeAssistantServiceCall] = []
    for action_to_call in actions_to_call:
        domain, service = action_to_call.split(".", 1)
        data = {"message": "clear_notification"}
        data["data"] = {"tag": f"ha_notifications_{alert['id']}"}
        commands.append(
            HomeAssistantServiceCall(
                domain=domain,
                service=service,
                data=data,
                target=clear_target,
            )
        )

    return commands


async def _render_notification(
    notification: Mapping[str, Any],
    confirmation: ConfirmationConfig | None,
    request: NotificationRequest,
    render: TemplateRenderer,
    snapshot: RegistrySnapshot,
) -> _RenderedNotification:
    notification = NotificationConfig.model_validate(notification)
    template_values = {"request": request}
    title = await render_values(notification.title, template_values, render)
    message = await render_values(notification.message, template_values, render)
    if (
        confirmation
        and confirmation.reminders.show_attempts
        and isinstance(title, str)
        and isinstance(request.attempt, int)
        and request.attempt > 1
    ):
        title = (
            f"{title} ({request.attempt}/"
            f"{confirmation.reminders.max_attempts or 1})"
        )
    target = await render_values(notification.target, template_values, render)
    target = resolve_user_notification_target(snapshot, target)
    extra_data = await render_values(
        notification.data or {}, template_values, render
    )

    return _RenderedNotification(
        title, message, target, _normalized_extra_data(extra_data), confirmation
    )


def _normalized_extra_data(extra_data: Any) -> dict[str, Any]:
    if not isinstance(extra_data, dict):
        return {}
    return remove_nulls(deepcopy(extra_data))


# ----------------------------------------------------------------------
# Route planning
# ----------------------------------------------------------------------


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
    request: NotificationRequest,
    capabilities: NotificationCapabilitySet,
    *,
    propagate_errors: bool = False,
) -> list[HomeAssistantServiceCall]:
    alert = request.alert
    notification_actions = list(request.notification_actions)

    render = capabilities.render
    snapshot = capabilities.snapshot

    commands: list[HomeAssistantServiceCall] = []
    if request.replace_existing:
        commands.extend(
            await _clear_commands(
                NotificationClearRequest(alert, request.now), snapshot, render
            )
        )

    try:
        send_commands = await plan_delivery(
            request,
            snapshot,
            render,
            notification_actions=notification_actions,
        )
    except Exception:  # noqa: BLE001 - reported as an event, not re-raised
        if propagate_errors:
            raise

        return commands

    commands.extend(send_commands)
    return commands


async def clear_requested(
    request: NotificationClearRequest,
    capabilities: NotificationCapabilitySet,
) -> list[HomeAssistantServiceCall]:
    return await _clear_commands(
        request,
        capabilities.snapshot,
        capabilities.render,
    )


async def _clear_commands(
    request: NotificationClearRequest,
    snapshot: RegistrySnapshot,
    render: TemplateRenderer,
) -> list[HomeAssistantServiceCall]:
    try:
        commands = await plan_clear(request, snapshot, render)
    except Exception:
        _LOGGER.exception(
            "Failed clearing notification for %s", request.alert["id"]
        )
        return []

    return commands


def _service_data_for_notification(
    rendered: _RenderedNotification,
    has_confirmation: bool,
    *,
    include_extra_data: bool,
    notification_id: str,
    notification_actions: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    extra_data = rendered.extra_data
    if has_confirmation:
        if rendered.confirmation is None:
            raise ValueError("Confirmation configuration is required.")
        actions = list(extra_data.get("actions", []))
        actions.extend(notification_actions or [])
        extra_data["actions"] = actions
        timeout = rendered.confirmation.reminders.timeout
        if timeout is not None and float(timeout) > 0:
            extra_data["timeout"] = int(float(timeout))

    service_data: dict[str, Any] = {"message": str(rendered.message)}
    if rendered.title:
        service_data["title"] = str(rendered.title)
    if include_extra_data and extra_data:
        service_data["data"] = {**extra_data, "tag": notification_id}
    elif include_extra_data:
        service_data["data"] = {"tag": notification_id}

    return remove_nulls(service_data)


def _log_plan(
    alert_id: str,
    actions_to_call: list[str],
    requested_counts: dict[str, int],
) -> None:
    _LOGGER.debug(
        "Notification delivery plan alert_id=%s requested=%s",
        alert_id,
        requested_counts,
    )
    _LOGGER.info(
        "Notification delivery alert_id=%s recipients=%d",
        alert_id,
        len(actions_to_call),
    )
