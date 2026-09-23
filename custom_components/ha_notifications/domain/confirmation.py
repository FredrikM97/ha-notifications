"""Shared confirmation response values passed between application workflows."""
from __future__ import annotations

from dataclasses import dataclass, field


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

    @property
    def next_attempt(self) -> int | None:
        """Return the one-based attempt number for the next delivery."""

        if not self.action_ids:
            return None
        return self.attempts + 1
