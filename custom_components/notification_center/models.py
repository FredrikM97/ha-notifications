"""Configuration models and normalization."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from datetime import timedelta
from typing import Any, Mapping

from .const import CONFIG_VERSION


def _list(value: Any) -> list:
    """Convert a scalar/list value to a list."""
    if value is None:
        return []

    if isinstance(value, list):
        return value

    return [value]


def _merge(
    base: dict[str, Any],
    override: dict[str, Any],
) -> dict[str, Any]:
    """Deep merge dictionaries."""
    result = deepcopy(base)

    for key, value in override.items():
        if (
            isinstance(result.get(key), dict)
            and isinstance(value, dict)
        ):
            result[key] = _merge(
                result[key],
                value,
            )
        else:
            result[key] = deepcopy(value)

    return result


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
        return timedelta(
            seconds=float(value)
        )

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

            return timedelta(
                seconds=float(value)
            )

        except ValueError:
            raise ValueError(
                f"Invalid duration: {value}"
            )

    raise ValueError(
        f"Unsupported duration: {value!r}"
    )


def duration_to_mapping(
    value: Any,
) -> dict[str, int | float]:
    """Convert duration to readable YAML mapping."""
    duration = parse_duration(value)

    if duration is None:
        return {}

    seconds = duration.total_seconds()

    days, remainder = divmod(
        seconds,
        86400,
    )

    hours, remainder = divmod(
        remainder,
        3600,
    )

    minutes, seconds = divmod(
        remainder,
        60,
    )

    result: dict[str, int | float] = {}

    if days:
        result["days"] = int(days)

    if hours:
        result["hours"] = int(hours)

    if minutes:
        result["minutes"] = int(minutes)

    if seconds:
        result["seconds"] = (
            int(seconds)
            if seconds.is_integer()
            else seconds
        )

    return result or {"seconds": 0}


def duration_to_string(
    value: Any,
    default: str = "00:00:00",
) -> str:
    """Convert a duration to an HTML time-input compatible string."""
    duration = parse_duration(value)

    if duration is None:
        return default

    total_seconds = max(
        0,
        int(duration.total_seconds()),
    )

    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def _slug(value: str) -> str:
    """Create a simple alert ID."""
    value = value.lower().strip()

    value = re.sub(
        r"[^a-z0-9]+",
        "_",
        value,
    )

    value = value.strip("_")

    return value or "alert"


def normalize_target(
    target: Any,
) -> dict[str, list[str]]:
    """Normalize notification target."""
    if not isinstance(target, dict):
        return {}

    result: dict[str, list[str]] = {}

    for key in (
        "device_id",
        "area_id",
        "floor_id",
        "label_id",
        "entity_id",
        "user_id",
    ):
        values = [
            str(item)
            for item in _list(
                target.get(key)
            )
            if item
        ]

        if values:
            result[key] = values

    return result


def normalize_condition(
    condition: Any,
) -> dict[str, Any]:
    """Normalize one visual condition."""
    if not isinstance(condition, dict):
        return {
            "type": "template",
            "template": str(condition or ""),
        }

    result = deepcopy(condition)

    result.setdefault(
        "type",
        "template",
    )

    return result


def normalize_notification(
    notification: Any,
    defaults: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize one notification into the canonical shape."""
    defaults = defaults or {}

    source = deepcopy(notification) if isinstance(notification, dict) else {}
    merged = _merge(defaults, source)

    title = merged.get("title", "Reminder")
    message = merged.get("message", "")

    extra_data = merged.get("data")
    if not isinstance(extra_data, dict):
        extra_data = {}

    confirmation_source = merged.get("confirmation", {})
    if not isinstance(confirmation_source, dict):
        confirmation_source = {}

    confirmation = confirmation_source

    actions = confirmation.get("actions")
    if not isinstance(actions, list):
        actions = []

    actions_enabled = bool(
        confirmation.get(
            "actions_enabled",
            bool(actions),
        )
    )

    normalized_confirmation = {
        "enabled": bool(
            confirmation.get(
                "enabled",
                bool(confirmation.get("button")),
            )
        ),
        "button": str(confirmation.get("button") or ""),
        "resend_interval": deepcopy(
            confirmation.get("resend_interval", {"minutes": 30})
        ),
        "max_attempts": max(
            1,
            min(20, int(confirmation.get("max_attempts", 5))),
        ),
        "completion_message": str(
            confirmation.get("completion_message") or ""
        ),
        "notify_on_confirmation": bool(
            confirmation.get("notify_on_confirmation", False)
        ),
        "confirmation_message": str(
            confirmation.get("confirmation_message") or ""
        ),
        "actions_enabled": actions_enabled,
    }

    if actions:
        normalized_confirmation["actions"] = deepcopy(actions)

    result = {
        "action": merged.get("action"),
        "target": normalize_target(merged.get("target")),
        "title": str(title or ""),
        "message": str(message or ""),
    }

    if extra_data:
        result["data"] = deepcopy(extra_data)

    notification_actions = merged.get("actions")
    if not isinstance(notification_actions, list):
        notification_actions = []

    notification_actions_enabled = bool(
        merged.get("actions_enabled", bool(notification_actions))
    )
    result["actions_enabled"] = notification_actions_enabled
    if notification_actions:
        result["actions"] = deepcopy(notification_actions)

    repeat = merged.get("repeat")
    if repeat is not None:
        result["repeat"] = deepcopy(repeat)

    result["confirmation"] = normalized_confirmation
    return result


def normalize_alert(
    alert: Any,
    notification_defaults: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize one alert into the canonical persisted shape."""
    if not isinstance(alert, dict):
        raise ValueError("Alert must be a mapping.")

    source = deepcopy(alert)

    alert_id = str(
        source.get("id")
        or _slug(str(source.get("name", "alert")))
    )
    name = str(source.get("name", alert_id))

    monitor = deepcopy(source.get("monitor", {}))
    if not isinstance(monitor, dict):
        monitor = {}

    normalized_monitor = {
        "on_change": bool(monitor.get("on_change", True)),
        "startup": bool(monitor.get("startup", True)),
    }
    if monitor.get("interval") is not None:
        normalized_monitor["interval"] = monitor["interval"]

    conditions = source.get("conditions", [])
    if isinstance(conditions, dict):
        conditions = [conditions]
    if not isinstance(conditions, list):
        raise ValueError("conditions must be a list")

    normalized_conditions = [
        normalize_condition(item) for item in conditions
    ]

    notification_input = deepcopy(source.get("notification", {}))
    if not isinstance(notification_input, dict):
        notification_input = {}

    notification = normalize_notification(
        notification_input,
        notification_defaults,
    )

    result = {
        "id": alert_id,
        "name": name,
        "enabled": bool(source.get("enabled", True)),
        "description": str(source.get("description") or ""),
        "icon": str(source.get("icon") or "mdi:bell-outline"),
        "monitor": normalized_monitor,
        "conditions": normalized_conditions,
        "notification": notification,
    }

    for key in ("created_at", "updated_at"):
        if source.get(key) is not None:
            result[key] = source[key]

    return result

def normalize_config(
    config: Any,
) -> dict[str, Any]:
    """Normalize complete configuration."""
    if not isinstance(
        config,
        dict,
    ):
        config = {}

    defaults = config.get(
        "defaults",
        {},
    )

    if not isinstance(
        defaults,
        dict,
    ):
        defaults = {}

    notification_defaults = defaults.get(
        "notification",
        {},
    )

    if not isinstance(
        notification_defaults,
        dict,
    ):
        notification_defaults = {}

    alerts = config.get(
        "alerts",
        [],
    )

    if isinstance(
        alerts,
        dict,
    ):
        alerts = list(
            alerts.values()
        )

    if not isinstance(
        alerts,
        list,
    ):
        raise ValueError(
            "alerts must be a list"
        )

    result = {
        "version": CONFIG_VERSION,
        "alerts": [
            normalize_alert(
                alert,
                notification_defaults,
            )
            for alert in alerts
        ],
    }

    return result


def _seconds(value: Any) -> int:
    """Get whole seconds."""
    duration = parse_duration(
        value,
        timedelta(),
    )

    return max(
        0,
        int(
            duration.total_seconds()
        ),
    )


def compile_condition(
    alert: dict[str, Any],
) -> str:
    """Compile visual conditions into one Jinja condition."""
    expressions: list[str] = []

    for condition in alert.get(
        "conditions",
        [],
    ):
        condition_type = condition.get(
            "type"
        )

        if condition_type == "state":
            entity_id = str(
                condition.get(
                    "entity_id",
                    "",
                )
            )

            state = str(
                condition.get(
                    "state",
                    "",
                )
            )

            if not entity_id:
                continue

            expression = (
                f"is_state("
                f"{json.dumps(entity_id)}, "
                f"{json.dumps(state)}"
                f")"
            )

            duration = _seconds(
                condition.get("for")
            )

            if duration:
                expression = (
                    "("
                    f"{expression}"
                    " and "
                    f"(now() - states["
                    f"{json.dumps(entity_id)}"
                    "].last_changed)"
                    ".total_seconds() >= "
                    f"{duration}"
                    ")"
                )

            expressions.append(
                expression
            )

        elif condition_type == "numeric":
            entity_id = str(
                condition.get(
                    "entity_id",
                    "",
                )
            )

            if not entity_id:
                continue

            expression = (
                f"states("
                f"{json.dumps(entity_id)}"
                ") | float(0)"
            )

            parts: list[str] = []

            if condition.get(
                "above"
            ) is not None:
                parts.append(
                    f"{expression} > "
                    f"{float(condition['above'])}"
                )

            if condition.get(
                "below"
            ) is not None:
                parts.append(
                    f"{expression} < "
                    f"{float(condition['below'])}"
                )

            if parts:
                expressions.append(
                    "("
                    + " and ".join(parts)
                    + ")"
                )

        elif condition_type == "attribute":
            entity_id = str(
                condition.get(
                    "entity_id",
                    "",
                )
            )

            attribute = str(
                condition.get(
                    "attribute",
                    "",
                )
            )

            expected = condition.get(
                "value"
            )

            if (
                entity_id
                and attribute
            ):
                expressions.append(
                    f"state_attr("
                    f"{json.dumps(entity_id)}, "
                    f"{json.dumps(attribute)}"
                    f") == "
                    f"{json.dumps(expected)}"
                )

        elif condition_type == "template":
            template = str(
                condition.get(
                    "template",
                    "",
                )
            ).strip()

            if (
                template.startswith("{{")
                and template.endswith("}}")
            ):
                template = template[2:-2].strip()

            if template:
                expressions.append(
                    f"({template})"
                )

    if not expressions:
        return "{{ true }}"

    return "{{ " + " and ".join(expressions) + " }}"