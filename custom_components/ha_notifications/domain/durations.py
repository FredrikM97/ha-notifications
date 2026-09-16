"""Duration parsing and formatting helpers."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Mapping


def parse_duration(
    value: Any,
    default: timedelta | None = None,
) -> timedelta | None:
    """Parse a Home Assistant style duration."""

    if value is None:
        return default

    if isinstance(value, timedelta):
        return value

    if isinstance(value, (int, float)):
        return timedelta(seconds=float(value))

    if isinstance(value, Mapping):
        return timedelta(
            days=float(value.get("days", 0)),
            hours=float(value.get("hours", 0)),
            minutes=float(value.get("minutes", 0)),
            seconds=float(value.get("seconds", 0)),
        )

    if isinstance(value, str):
        value = value.strip()

        if not value:
            return default

        parts = value.split(":")

        try:
            if len(parts) == 3:
                return timedelta(
                    hours=float(parts[0]),
                    minutes=float(parts[1]),
                    seconds=float(parts[2]),
                )

            if len(parts) == 2:
                return timedelta(
                    hours=float(parts[0]),
                    minutes=float(parts[1]),
                )

            return timedelta(seconds=float(value))

        except ValueError:
            raise ValueError(f"Invalid duration: {value}")

    raise ValueError(f"Unsupported duration: {value!r}")


def duration_seconds(value: Any) -> int | float | None:
    """Normalize an HA-style duration (string/mapping/number) to seconds.

    Used as a `field_validator(mode="before")` for pydantic fields typed
    `int | float | None` that accept frontend duration strings like
    "00:30:00" alongside plain numeric seconds.
    """

    if value is None:
        return None

    if isinstance(value, (int, float)):
        return value

    duration = parse_duration(value)

    if duration is None:
        return None

    seconds = duration.total_seconds()

    if seconds.is_integer():
        return int(seconds)

    return seconds
