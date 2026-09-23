"""Typed events exchanged with the alert workflow."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Mapping

from .confirmation import ConfirmationContext

if TYPE_CHECKING:
    from .runtime import AlertRuntimeState


@dataclass(frozen=True, slots=True)
class NotificationRequest:
    """Typed request for one alert notification delivery attempt."""

    runtime: AlertRuntimeState
    replace_existing: bool
    notification_actions: tuple[Mapping[str, str], ...] = ()
    condition_facts: Mapping[str, bool] = field(default_factory=dict)
    trigger_source: str = ""


@dataclass(frozen=True, slots=True)
class NotificationClearRequest:
    """Typed request to clear an alert notification."""

    runtime: AlertRuntimeState


@dataclass(frozen=True, slots=True)
class NotificationOutcome:
    """The result of one alert notification delivery attempt."""

    now: datetime
    success: bool
    error: str | None = None


class ConditionStatus(StrEnum):
    """Classification of one evaluated condition result."""

    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class ConditionWorkflowEvent:
    """One evaluated condition result ready for ordered alert handling."""

    runtime: AlertRuntimeState
    source: str
    now: datetime
    status: ConditionStatus
    facts: Mapping[str, bool] = field(default_factory=dict)
    error: str | None = None
    replace_existing: bool = True
    flow_id: str | None = None


@dataclass(frozen=True, slots=True)
class ConfirmationWorkflowEvent:
    """A resolved response ready for ordered alert handling."""

    runtime: AlertRuntimeState
    confirmation: ConfirmationContext
    now: datetime
