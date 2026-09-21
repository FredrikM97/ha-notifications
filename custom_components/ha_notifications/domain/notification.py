"""Values returned by notification application workflows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class NotificationOutcome:
    """The result of one alert notification delivery attempt."""

    attempt: int
    now: datetime
    success: bool
    error: str | None = None
