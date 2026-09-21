"""Shared confirmation response values passed between application workflows."""

from __future__ import annotations

from dataclasses import dataclass


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

    def template_values(self) -> dict[str, str]:
        """Return the flat values exposed to Home Assistant templates."""

        return {
            "confirmed_by": self.confirmed_by,
            "confirmation_response_id": self.selection.response_id,
            "confirmation_response": self.selection.label,
        }

    def history_details(self) -> dict[str, str]:
        """Return generic details for a confirmation history entry."""

        return {
            "confirmed_by": self.confirmed_by,
            "response_id": self.selection.response_id,
            "response": self.selection.label,
        }


@dataclass(frozen=True, slots=True)
class ConfirmationActionSet:
    """Prepared response actions owned by the confirmation feature."""

    selections: tuple[ConfirmationSelection, ...]

    @property
    def primary_action_id(self) -> str | None:
        """Return the first action for legacy scalar consumers."""

        return self.selections[0].action_id if self.selections else None

    def notification_actions(self) -> list[dict[str, str]]:
        """Project responses into Home Assistant notification actions."""

        return [
            {"action": item.action_id, "title": item.label}
            for item in self.selections
        ]
