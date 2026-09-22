"""Typed events exchanged with the alert workflow."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping

from .confirmation import ConfirmationContext
from .service_calls import ServiceEffectsRequest


@dataclass(frozen=True, slots=True)
class NotificationRequest:
    """Typed request for one alert notification delivery attempt."""

    alert: Mapping[str, Any]
    attempt: int | None
    now: datetime
    replace_existing: bool
    notification_actions: tuple[Mapping[str, str], ...] = ()
    condition_facts: Mapping[str, bool] = field(default_factory=dict)
    trigger_source: str = ""


@dataclass(frozen=True, slots=True)
class NotificationClearRequest:
    """Typed request to clear an alert notification."""

    alert: Mapping[str, Any]
    now: datetime


@dataclass(frozen=True, slots=True)
class NotificationOutcome:
    """The result of one alert notification delivery attempt."""

    attempt: int | None
    now: datetime
    success: bool
    error: str | None = None


@dataclass(frozen=True, slots=True)
class ConditionTransition:
    """Boolean condition evaluation passed to the alert workflow."""

    active: bool | None
    error: str | None = None
    source: str = ""
    facts: Mapping[str, bool] | None = None


@dataclass(frozen=True, slots=True)
class ConditionActiveEvent:
    """An active condition ready for notification workflow effects."""

    alert: Mapping[str, Any]
    source: str
    facts: Mapping[str, bool]
    now: datetime
    notify: bool = True
    replace_existing: bool = True


@dataclass(frozen=True, slots=True)
class ConditionInactiveEvent:
    """An inactive condition ready for deactivation effects."""

    alert: Mapping[str, Any]
    source: str
    now: datetime


@dataclass(frozen=True, slots=True)
class ConditionErrorEvent:
    """A condition evaluation error ready for history effects."""

    alert: Mapping[str, Any]
    error: str
    source: str
    now: datetime


@dataclass(frozen=True, slots=True)
class ConfirmationWorkflowEvent:
    """A resolved response ready for ordered alert effects."""

    alert: Mapping[str, Any]
    confirmation: ConfirmationContext
    now: datetime


ConditionWorkflowEvent = (
    ConditionActiveEvent | ConditionInactiveEvent | ConditionErrorEvent
)
WorkflowEvent = ConditionWorkflowEvent | ConfirmationWorkflowEvent


@dataclass(frozen=True, slots=True)
class ClearNotificationEffect:
    """Clear the notification associated with one alert."""

    request: NotificationClearRequest


@dataclass(frozen=True, slots=True)
class SendNotificationEffect:
    """Send one ordered alert notification attempt."""

    request: NotificationRequest


@dataclass(frozen=True, slots=True)
class PersistEffect:
    """Persist runtime state after an ordered workflow phase."""


@dataclass(frozen=True, slots=True)
class ServiceEffectsEffect:
    """Run ordered post-delivery Home Assistant service effects."""

    request: ServiceEffectsRequest

    @property
    def attempt(self) -> int | None:
        return self.request.attempt


WorkflowEffect = (
    ClearNotificationEffect
    | SendNotificationEffect
    | PersistEffect
    | ServiceEffectsEffect
)
