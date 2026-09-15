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


def duration_to_mapping(value: Any) -> dict[str, int | float]:
    """Convert duration to readable YAML mapping."""

    duration = parse_duration(value)

    if duration is None:
        return {}

    seconds = duration.total_seconds()
    days, remainder = divmod(seconds, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, seconds = divmod(remainder, 60)

    result: dict[str, int | float] = {}

    if days:
        result["days"] = int(days)

    if hours:
        result["hours"] = int(hours)

    if minutes:
        result["minutes"] = int(minutes)

    if seconds:
        normalized_seconds: int | float = seconds
        if seconds.is_integer():
            normalized_seconds = int(seconds)
        result["seconds"] = normalized_seconds

    return result or {"seconds": 0}


def duration_to_string(
    value: Any,
    default: str = "00:00:00",
) -> str:
    """Convert a duration to an HTML time-input compatible string."""

    duration = parse_duration(value)

    if duration is None:
        return default

    total_seconds = max(0, int(duration.total_seconds()))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
