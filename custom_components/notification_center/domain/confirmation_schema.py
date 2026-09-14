"""Normalization for confirmation-specific notification settings."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .durations import parse_duration


def _duration(value: Any, default: Any) -> Any:
    if value is None or value == "[object Object]":
        return deepcopy(default)

    try:
        parse_duration(value)
    except ValueError:
        return deepcopy(default)

    return deepcopy(value)


@dataclass(frozen=True)
class ConfirmationConfig:
    enabled: bool
    button: str
    resend_interval: Any
    max_attempts: int
    completion_message: str
    notify_on_confirmation: bool
    confirmation_message: str
    clear_on_confirmation: bool
    actions_enabled: bool
    actions: list[dict[str, Any]] | None = None

    @classmethod
    def from_mapping(cls, confirmation: Any) -> "ConfirmationConfig":
        """Build the feature-owned configuration from YAML data."""

        if not isinstance(confirmation, dict):
            confirmation = {}

        actions = confirmation.get("actions")
        if not isinstance(actions, list):
            actions = []

        return cls(
            enabled=bool(
                confirmation.get("enabled", bool(confirmation.get("button")))
            ),
            button=str(confirmation.get("button") or ""),
            resend_interval=_duration(
                confirmation.get("resend_interval"), {"minutes": 30}
            ),
            max_attempts=max(1, min(20, int(confirmation.get("max_attempts", 5)))),
            completion_message=str(confirmation.get("completion_message") or ""),
            notify_on_confirmation=bool(
                confirmation.get("notify_on_confirmation", False)
            ),
            confirmation_message=str(
                confirmation.get("confirmation_message") or ""
            ),
            clear_on_confirmation=bool(
                confirmation.get("clear_on_confirmation", True)
            ),
            actions_enabled=bool(
                confirmation.get("actions_enabled", bool(actions))
            ),
            actions=deepcopy(actions) or None,
        )

    def to_mapping(self) -> dict[str, Any]:
        result = {
            "enabled": self.enabled,
            "button": self.button,
            "resend_interval": deepcopy(self.resend_interval),
            "max_attempts": self.max_attempts,
            "completion_message": self.completion_message,
            "notify_on_confirmation": self.notify_on_confirmation,
            "confirmation_message": self.confirmation_message,
            "clear_on_confirmation": self.clear_on_confirmation,
            "actions_enabled": self.actions_enabled,
        }
        if self.actions:
            result["actions"] = deepcopy(self.actions)
        return result


def normalize_confirmation(confirmation: Any) -> dict[str, Any]:
    """Return the canonical confirmation mapping owned by this feature."""

    return ConfirmationConfig.from_mapping(confirmation).to_mapping()
