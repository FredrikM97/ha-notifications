"""Shared confirmation response values passed between application workflows."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class ConfirmationSelection:
    """The response selected by one Home Assistant notification action."""

    action_id: str
    response_id: str
    label: str


@dataclass(frozen=True, slots=True)
class ConfirmationContext:
    """The confirmation facts needed by downstream ordered workflows."""

    confirmed_by: str
    selection: ConfirmationSelection


@dataclass(slots=True)
class PendingConfirmationState:
    """Mutable pending confirmation state held at the runtime boundary."""

    action_ids: dict[str, str] = field(default_factory=dict)
    attempts: int = 0

    @classmethod
    def from_runtime(cls, runtime: Mapping[str, Any]) -> PendingConfirmationState:
        """Load pending confirmation state from persisted runtime data."""

        value = runtime.get("confirmation") or {}
        return cls(
            action_ids=dict(value.get("action_ids") or {}),
            attempts=int(value.get("attempts", 0)),
        )

    def to_runtime(self) -> dict[str, Any]:
        """Serialize pending confirmation state for runtime persistence."""

        return {
            "confirmation": {
                "action_ids": dict(self.action_ids),
                "attempts": self.attempts,
            }
        }


@dataclass(frozen=True, slots=True)
class ConfirmationActionSet:
    """Prepared response actions owned by the confirmation feature."""

    selections: tuple[ConfirmationSelection, ...]

    def notification_actions(self) -> list[dict[str, str]]:
        """Project responses into Home Assistant notification actions."""

        return [
            {"action": item.action_id, "title": item.label}
            for item in self.selections
        ]
