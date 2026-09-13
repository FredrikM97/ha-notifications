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
        result["seconds"] = int(seconds) if seconds.is_integer() else seconds

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