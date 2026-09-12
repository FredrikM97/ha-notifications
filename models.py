"""Configuration models and normalization."""

from __future__ import annotations

from copy import deepcopy
from datetime import timedelta
import json
import re
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
        "label_id",
        "entity_id",
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
    """Normalize one notification."""
    defaults = defaults or {}

    if not isinstance(notification, dict):
        notification = {}

    notification = deepcopy(notification)

    # Legacy structure:
    #
    # notification:
    #   action: notify...
    #   target: ...
    #   data:
    #     title:
    #     message:
    #
    legacy_data = notification.pop(
        "data",
        {},
    )

    if not isinstance(
        legacy_data,
        dict,
    ):
        legacy_data = {}

    merged = _merge(
        defaults,
        notification,
    )

    title = merged.get(
        "title",
        legacy_data.get(
            "title",
            "Reminder",
        ),
    )

    message = merged.get(
        "message",
        legacy_data.get(
            "message",
            "",
        ),
    )

    extra_data = merged.get(
        "extra_data",
        {},
    )

    legacy_confirmation = {}

    if "confirmation_button" in legacy_data:
        legacy_confirmation["button"] = legacy_data[
            "confirmation_button"
        ]

    for key in (
        "completion_message",
        "resend_interval",
        "max_attempts",
    ):
        if key in legacy_data:
            legacy_confirmation[key] = legacy_data[key]

    if "confirmation_actions" in legacy_data:
        legacy_confirmation["actions"] = legacy_data[
            "confirmation_actions"
        ]

    confirmation = deepcopy(
        merged.get(
            "confirmation",
            {},
        )
    )

    if not isinstance(confirmation, dict):
        confirmation = {}

    confirmation = _merge(
        legacy_confirmation,
        confirmation,
    )

    confirmation.setdefault(
        "enabled",
        bool(confirmation.get("button")),
    )

    if not extra_data:
        extra_data = {
            key: value
            for key, value in legacy_data.items()
            if key not in {
                "title",
                "message",
                "confirmation_button",
                "completion_message",
                "resend_interval",
                "max_attempts",
                "confirmation_actions",
            }
        }

    return {
        "action": merged.get("action"),
        "target": normalize_target(
            merged.get("target")
        ),
        "title": str(title or ""),
        "message": str(message or ""),
        "data": deepcopy(extra_data),
        "repeat": deepcopy(
            merged.get("repeat")
        ),
        "confirmation": confirmation,
    }


def normalize_alert(
    alert: Any,
    notification_defaults: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize one alert."""
    if not isinstance(alert, dict):
        raise ValueError(
            "Alert must be a mapping."
        )

    source = deepcopy(alert)

    alert_id = str(
        source.get("id")
        or _slug(
            str(
                source.get(
                    "name",
                    "alert",
                )
            )
        )
    )

    name = str(
        source.get(
            "name",
            alert_id,
        )
    )

    monitor = deepcopy(
        source.get(
            "monitor",
            {},
        )
    )

    if not isinstance(
        monitor,
        dict,
    ):
        monitor = {}

    legacy_trigger = deepcopy(
        source.get(
            "trigger",
            {},
        )
    )

    if isinstance(
        legacy_trigger,
        dict,
    ):
        monitor = _merge(
            monitor,
            legacy_trigger,
        )

    if (
        "recheck_interval" in source
        and "interval" not in monitor
    ):
        monitor["interval"] = source[
            "recheck_interval"
        ]

    monitor.setdefault(
        "on_change",
        True,
    )

    monitor.setdefault(
        "startup",
        True,
    )

    conditions = source.get(
        "conditions"
    )

    if conditions is None:
        legacy_condition = source.get(
            "condition"
        )

        if legacy_condition:
            conditions = [
                {
                    "type": "template",
                    "template": legacy_condition,
                }
            ]
        else:
            conditions = []

    if isinstance(
        conditions,
        dict,
    ):
        conditions = [conditions]

    conditions = [
        normalize_condition(item)
        for item in conditions
    ]

    notifications = source.get(
        "notifications"
    )

    if notifications is None:
        legacy_notification = source.get(
            "notification"
        )

        if legacy_notification is not None:
            notifications = [
                legacy_notification
            ]
        else:
            notifications = []

    if isinstance(
        notifications,
        dict,
    ):
        notifications = [
            notifications
        ]

    notifications = [
        normalize_notification(
            item,
            notification_defaults,
        )
        for item in notifications
    ]

    if not notifications:
        notifications = [
            normalize_notification(
                {
                    "title": name,
                    "message": "",
                },
                notification_defaults,
            )
        ]

    old_notification = (
        source.get("notification")
        if isinstance(
            source.get("notification"),
            dict,
        )
        else {}
    )

    confirmation = deepcopy(
        source.get(
            "confirmation",
            {},
        )
    )

    if not isinstance(
        confirmation,
        dict,
    ):
        confirmation = {}

    confirmation_button = (
        confirmation.get("button")
        or old_notification.get(
            "confirmation_button"
        )
    )

    completion_message = (
        confirmation.get(
            "completion_message"
        )
        or old_notification.get(
            "completion_message"
        )
    )

    resend_interval = (
        confirmation.get(
            "resend_interval"
        )
        or old_notification.get(
            "resend_interval"
        )
        or {"minutes": 30}
    )

    max_attempts = int(
        confirmation.get(
            "max_attempts",
            old_notification.get(
                "max_attempts",
                5,
            ),
        )
    )

    confirmation_actions = (
        confirmation.get(
            "actions"
        )
        or old_notification.get(
            "confirmation_actions",
        )
        or []
    )

    confirmation = {
        "enabled": bool(
            confirmation.get(
                "enabled",
                bool(confirmation_button),
            )
        ),
        "button": str(
            confirmation_button or ""
        ),
        "resend_interval": resend_interval,
        "max_attempts": max(
            1,
            min(
                20,
                max_attempts,
            ),
        ),
        "completion_message": str(
            completion_message or ""
        ),
        "actions": (
            deepcopy(
                confirmation_actions
            )
            if isinstance(
                confirmation_actions,
                list,
            )
            else []
        ),
    }

    for notification in notifications:
        notification["confirmation"] = _merge(
            confirmation,
            notification.get(
                "confirmation",
                {},
            ),
        )

    primary_notification = deepcopy(
        notifications[0]
    )

    return {
        "id": alert_id,
        "name": name,
        "enabled": bool(
            source.get(
                "enabled",
                True,
            )
        ),
        "notify_on_start": bool(
            source.get(
                "notify_on_start",
                monitor.get(
                    "startup",
                    True,
                ),
            )
        ),
        "monitor": monitor,
        "trigger": deepcopy(monitor),
        "logic": source.get(
            "logic",
            "all",
        ),
        "conditions": conditions,
        "notifications": notifications,
        "notification": primary_notification,
        "confirmation": confirmation,
    }


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

            if template:
                expressions.append(
                    f"({template})"
                )

    if not expressions:
        return "{{ true }}"

    logic = str(
        alert.get(
            "logic",
            "all",
        )
    ).lower()

    operator = (
        " or "
        if logic == "any"
        else " and "
    )

    return (
        "{{ "
        + operator.join(expressions)
        + " }}"
    )