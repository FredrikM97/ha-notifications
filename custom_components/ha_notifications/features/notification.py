"""Compose notification commands from content, targets, and capabilities."""

from __future__ import annotations

import logging
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
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
from ..domain.service_calls import ServiceCall
from ..domain.notification import NotificationOutcome
from ..domain.confirmation import ConfirmationContext
from ..domain.template_values import (
    TemplateRenderer,
    remove_nulls,
    render_template_values,
    template_context,
)
from ..support.templates import render_template
from .confirmation import ConfirmationConfig

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
        alert: dict[str, Any],
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
            or "{{ confirmed_by }} confirmed this notification."
        )
        completion_alert = deepcopy(self.alert)
        completion_alert["notification"] = self.notification.model_dump(
            exclude_none=True
        )
        variables = template_context(
            self.alert,
            1,
            self.now,
            False,
            trigger="confirmation",
            confirmation=self.context,
        )
        completion_alert["notification"]["message"] = await render_template_values(
            completion_message,
            variables,
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

    def capabilities(self) -> NotificationCapabilitySet:
        """Build the Home Assistant values required for one delivery plan."""

        hass = self._hass
        mobile_app_entries = list(hass.config_entries.async_entries("mobile_app"))
        return NotificationCapabilitySet(
            render=self._render_template,
            snapshot=RegistrySnapshot(
                area_registry=ar.async_get(hass),
                device_registry=dr.async_get(hass),
                entity_registry=er.async_get(hass),
                mobile_app_entries=mobile_app_entries,
                person_states=list(hass.states.async_all("person")),
                has_service=hass.services.has_service,
            ),
        )

    async def _render_template(
        self, source: str, variables: dict[str, Any] | None = None
    ) -> Any:
        return await render_template(self._hass, source, variables)

    async def _execute(self, calls: list[ServiceCall]) -> None:
        for call in calls:
            await self._hass.services.async_call(
                call.domain,
                call.service,
                service_data=call.data,
                target=call.target,
                blocking=True,
            )

    async def send(self, payload: dict[str, Any]) -> bool:
        """Plan and execute a notification request."""

        calls = await send_requested(
            {**payload, "propagate_errors": True}, self.capabilities()
        )
        await self._execute(calls)
        return True

    async def send_alert(
        self,
        alert: dict[str, Any],
        *,
        attempt: int,
        now: datetime,
        replace_existing: bool,
        test: bool = False,
        notification_actions: list[dict[str, str]] | None = None,
        condition_facts: dict[str, bool] | None = None,
        trigger_source: str = "",
    ) -> NotificationOutcome:
        """Send an alert without exposing delivery payload assembly to callers."""

        try:
            await self.send(
                {
                    "alert": alert,
                    "attempt": attempt,
                    "notification_actions": notification_actions or [],
                    "replace_existing": replace_existing,
                    "test": test,
                    "now": now,
                    "condition_facts": condition_facts or {},
                    "trigger_source": trigger_source,
                }
            )
        except Exception as err:
            return NotificationOutcome(attempt, now, False, str(err))
        return NotificationOutcome(attempt, now, True)

    async def send_completion(
        self,
        alert: dict[str, Any],
        *,
        now: datetime,
        test: bool,
    ) -> bool:
        """Send a rendered completion notification."""

        return await self.send_alert(
            alert,
            attempt=1,
            now=now,
            replace_existing=False,
            test=test,
        )

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
    alert: dict[str, Any],
    variables: dict[str, Any],
    snapshot: RegistrySnapshot,
    render: TemplateRenderer,
    notification_actions: list[dict[str, str]] | None = None,
) -> list[ServiceCall]:
    """Build the Home Assistant service calls that send one notification."""

    notification = NotificationConfig.model_validate(alert["notification"])
    rendered = await _render_notification(
        notification,
        ConfirmationConfig.from_alert(alert),
        variables,
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
        notification_id=str(
            variables.get("notification_id", f"ha_notifications_{alert['id']}")
        ),
        notification_actions=notification_actions,
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
) -> list[ServiceCall]:
    """Build the Home Assistant service calls that clear one notification."""

    notification = NotificationConfig.model_validate(alert["notification"])
    target = await render_template_values(notification.target, variables, render)
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

    commands: list[ServiceCall] = []
    for action_to_call in actions_to_call:
        domain, service = action_to_call.split(".", 1)
        data = {"message": "clear_notification"}
        data["data"] = {"tag": f"ha_notifications_{alert['id']}"}
        commands.append(
            ServiceCall(
                domain=domain,
                service=service,
                data=data,
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
    target = resolve_user_notification_target(snapshot, target)
    extra_data = await render_template_values(
        notification.data or {}, variables, render
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
    payload: dict[str, Any], capabilities: NotificationCapabilitySet
) -> list[ServiceCall]:
    alert = payload["alert"]
    now = payload["now"]
    variables = template_context(
        alert,
        payload["attempt"],
        now,
        payload.get("test", False),
        condition_facts=payload.get("condition_facts", {}),
        trigger=payload.get("trigger_source", ""),
    )
    notification_actions = payload.get("notification_actions", [])

    render = capabilities.render
    snapshot = capabilities.snapshot

    commands: list[ServiceCall] = []
    if payload.get("replace_existing"):
        commands.extend(
            await _clear_commands(alert, now, snapshot, render)
        )

    try:
        send_commands = await plan_delivery(
            alert,
            variables,
            snapshot,
            render,
            notification_actions=notification_actions,
        )
    except Exception:  # noqa: BLE001 - reported as an event, not re-raised
        if payload.get("propagate_errors", False):
            raise

        return commands

    commands.extend(send_commands)
    return commands


async def clear_requested(
    payload: dict[str, Any], capabilities: NotificationCapabilitySet
) -> list[ServiceCall]:
    alert = payload["alert"]
    now = payload.get("now")

    return await _clear_commands(
        alert,
        now,
        capabilities.snapshot,
        capabilities.render,
    )


async def _clear_commands(
    alert: dict[str, Any],
    now: Any,
    snapshot: RegistrySnapshot,
    render: TemplateRenderer,
) -> list[ServiceCall]:
    variables = template_context(alert, 1, now, False)
    try:
        commands = await plan_clear(alert, variables, snapshot, render)
    except Exception:
        _LOGGER.exception("Failed clearing notification for %s", alert["id"])
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
