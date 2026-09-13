"""Configuration models and normalization."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

from .const import CONFIG_VERSION
from .durations import (
    duration_to_mapping as duration_to_mapping,
)
from .durations import (
    duration_to_string as duration_to_string,
)
from .durations import (
    parse_duration as parse_duration,
)
from .model_conditions import compile_condition as compile_condition

__all__ = (
    "compile_condition",
    "duration_to_mapping",
    "duration_to_string",
    "normalize_alert",
    "normalize_condition",
    "normalize_config",
    "normalize_notification",
    "normalize_target",
    "parse_duration",
)


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

    if result.get("for") is not None:
        duration = _normalize_duration_value(result.get("for"), None)
        if duration is None:
            result.pop("for", None)
        else:
            result["for"] = duration

    return result


def _normalize_duration_string(value: Any) -> str | None:
    if value is None or value == "[object Object]":
        return None

    if isinstance(value, str):
        try:
            parse_duration(value)
        except ValueError:
            return None
        return value

    try:
        return duration_to_string(value)
    except ValueError:
        return None


def _normalize_duration_value(value: Any, default: Any) -> Any:
    if value is None or value == "[object Object]":
        return deepcopy(default)

    try:
        parse_duration(value)
    except ValueError:
        return deepcopy(default)

    return deepcopy(value)


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
        "resend_interval": _normalize_duration_value(
            confirmation.get("resend_interval"),
            {"minutes": 30},
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
        "clear_on_confirmation": bool(
            confirmation.get("clear_on_confirmation", True)
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
    if isinstance(repeat, dict):
        normalized_repeat = deepcopy(repeat)
        normalized_repeat["interval"] = _normalize_duration_value(
            repeat.get("interval"),
            "00:30",
        )
        result["repeat"] = normalized_repeat

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
    interval = _normalize_duration_string(monitor.get("interval"))
    if interval is not None:
        normalized_monitor["interval"] = interval

    conditions = source.get("conditions")
    if conditions is None:
        conditions = []
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

    logic = source.get("logic")
    if logic in ("any", "or", "all", "and"):
        result["logic"] = "any" if logic in ("any", "or") else "all"

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

