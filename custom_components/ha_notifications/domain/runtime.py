"""Typed process-local alert runtime state."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any

from .confirmation import PendingConfirmationState


@dataclass(slots=True)
class AlertRuntimeState:
    """Mutable alert runtime state."""

    alert: dict[str, Any]
    active: bool = False
    acknowledged: bool = False
    confirmation: PendingConfirmationState = field(
        default_factory=PendingConfirmationState
    )
    flow_id: str | None = None
    started_at: str | None = None
    last_evaluated: str | None = None
    last_notified: str | None = None
    confirmed_at: str | None = None
    confirmed_by: str | None = None
    last_error: str | None = None

    @classmethod
    def reset(cls, runtime: AlertRuntimeState) -> AlertRuntimeState:
        """Create reset state while preserving the evaluation timestamp."""

        return cls(
            alert=dict(runtime.alert),
            last_evaluated=runtime.last_evaluated,
        )

    @classmethod
    def for_alert(cls, alert: Mapping[str, Any]) -> AlertRuntimeState:
        """Create runtime state from one configured alert snapshot."""

        return cls(alert=dict(alert))

    def activate(self, now: datetime) -> None:
        """Start a new alert activation."""

        self.active = True
        self.acknowledged = False
        self.started_at = now.isoformat()
        alert_id = str(self.alert["id"])
        self.flow_id = f"flow_{alert_id}_{uuid.uuid4().hex[:8]}"

    def evaluate(self, now: datetime) -> None:
        """Record the latest condition evaluation time."""

        self.last_evaluated = now.isoformat()

    def deactivate(self) -> None:
        """Clear state tied to the current alert activation."""

        self.active = False
        self.acknowledged = False
        self.flow_id = None

    def write_to(self, target: dict[str, Any]) -> None:
        """Write an independent dictionary copy of the complete runtime state."""

        target.clear()
        target.update(asdict(self))

