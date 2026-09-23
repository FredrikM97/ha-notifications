"""Typed process-local alert runtime state."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field, fields, is_dataclass
from datetime import datetime
from typing import Any

from .confirmation import PendingConfirmationState


@dataclass(slots=True)
class AlertRuntimeState:
    """Mutable alert runtime state."""

    config: dict[str, Any]
    state: dict[str, Any] = field(default_factory=dict)
    trace: list[object] = field(default_factory=list)

    @classmethod
    def reset(cls, runtime: AlertRuntimeState) -> AlertRuntimeState:
        """Create reset state while preserving the evaluation timestamp."""

        state: dict[str, Any] = {}
        if runtime.last_evaluated:
            state["last_evaluated"] = runtime.last_evaluated
        return cls(config=dict(runtime.config), state=state)

    @classmethod
    def for_alert(cls, alert: Mapping[str, Any]) -> AlertRuntimeState:
        """Create runtime state from one configured alert snapshot."""

        return cls(config=dict(alert))

    def activate(self, now: datetime) -> None:
        """Start a new alert activation."""

        self.state.update(
            active=True,
            flow_id=self._new_flow_id(),
            started_at=now.isoformat(),
            last_error=None,
            acknowledged=False,
            confirmed_at=None,
            confirmed_by=None,
        )

    def _new_flow_id(self) -> str:
        alert_id = str(self.config["id"])
        return f"flow_{alert_id}_{uuid.uuid4().hex[:8]}"

    def evaluate(self, now: datetime) -> None:
        """Record the latest condition evaluation time."""

        self.state["last_evaluated"] = now.isoformat()

    def deactivate(self, now: datetime) -> None:
        """Finish the current alert activation and discard its trace."""

        self.state.update(
            active=False,
            last_evaluated=now.isoformat(),
            flow_id=None,
            started_at=None,
            acknowledged=False,
            confirmed_at=None,
            confirmed_by=None,
        )
        self.trace.clear()

    @property
    def confirmation(self) -> PendingConfirmationState:
        """Return the existing pending confirmation fact held in the trace."""

        for fact in reversed(self.trace):
            if isinstance(fact, PendingConfirmationState):
                return fact
        pending = PendingConfirmationState()
        self.record_event(pending)
        return pending

    @property
    def condition_active(self) -> bool:
        return bool(self.state.get("active", False))

    @property
    def flow_id(self) -> str | None:
        return self.state.get("flow_id")

    @property
    def started_at(self) -> str | None:
        return self.state.get("started_at")

    @property
    def last_evaluated(self) -> str | None:
        return self.state.get("last_evaluated")

    @property
    def last_notified(self) -> str | None:
        return self.state.get("last_notified")

    @property
    def last_error(self) -> str | None:
        return self.state.get("last_error")

    @property
    def acknowledged(self) -> bool:
        return bool(self.state.get("acknowledged", False))

    @property
    def confirmed_at(self) -> str | None:
        return self.state.get("confirmed_at")

    @property
    def confirmed_by(self) -> str | None:
        return self.state.get("confirmed_by")

    def record_event(self, fact: object) -> None:
        """Append one existing typed workflow fact to the trace."""

        self.trace.append(fact)


def serialize_runtime(runtime: AlertRuntimeState) -> dict[str, Any]:
    """Return the transport shape of one runtime aggregate."""

    return {
        "config": dict(runtime.config),
        "state": dict(runtime.state),
        "trace": [_serialize_value(fact) for fact in runtime.trace],
    }


def _serialize_value(value: Any) -> Any:
    """Copy runtime values into JSON-safe dictionaries and sequences."""

    if isinstance(value, datetime):
        return value.isoformat()
    if is_dataclass(value):
        return {
            item.name: _serialize_value(getattr(value, item.name))
            for item in fields(value)
            if item.name != "runtime"
        }
    if isinstance(value, Mapping):
        return {key: _serialize_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize_value(item) for item in value]
    return value

