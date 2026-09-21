"""Typed alert runtime state and its persistence boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .confirmation import PendingConfirmationState


@dataclass(slots=True)
class AlertRuntimeState:
    """Mutable runtime values owned by one configured alert."""

    active: bool = False
    acknowledged: bool = False
    confirmation: PendingConfirmationState | None = None
    notification_id: str | None = None
    flow_id: str | None = None
    started_at: str | None = None
    last_evaluated: str | None = None
    last_notified: str | None = None
    confirmed_at: str | None = None
    confirmed_by: str | None = None
    last_error: str | None = None

    def __post_init__(self) -> None:
        if self.confirmation is None:
            self.confirmation = PendingConfirmationState()

    @classmethod
    def from_runtime(cls, runtime: Mapping[str, Any]) -> AlertRuntimeState:
        """Load alert runtime values from persisted state."""

        return cls(
            active=bool(runtime.get("active", False)),
            acknowledged=bool(runtime.get("acknowledged", False)),
            confirmation=PendingConfirmationState.from_runtime(runtime),
            notification_id=runtime.get("notification_id"),
            flow_id=runtime.get("flow_id"),
            started_at=runtime.get("started_at"),
            last_evaluated=runtime.get("last_evaluated"),
            last_notified=runtime.get("last_notified"),
            confirmed_at=runtime.get("confirmed_at"),
            confirmed_by=runtime.get("confirmed_by"),
            last_error=runtime.get("last_error"),
        )

    def to_runtime(self) -> dict[str, Any]:
        """Serialize alert runtime state at the persistence boundary."""

        return {
            "active": self.active,
            "acknowledged": self.acknowledged,
            **self.confirmation.to_runtime(),
            "notification_id": self.notification_id,
            "flow_id": self.flow_id,
            "started_at": self.started_at,
            "last_evaluated": self.last_evaluated,
            "last_notified": self.last_notified,
            "confirmed_at": self.confirmed_at,
            "confirmed_by": self.confirmed_by,
            "last_error": self.last_error,
        }

    def write_to(self, runtime: dict[str, Any]) -> None:
        """Replace the persisted runtime mapping with this state."""

        runtime.clear()
        runtime.update(self.to_runtime())
