"""Runtime state bookkeeping for HA Notifications alerts."""

from __future__ import annotations

from typing import Any

from homeassistant.util import dt as dt_util

from ..durations import parse_duration


def new_alert_state() -> dict[str, Any]:
    """Return the default runtime state for one alert."""

    return {
        "active": False,
        "acknowledged": False,
        "attempts": 0,
        "notification_id": None,
        "confirmation_action_id": None,
        "flow_id": None,
        "started_at": None,
        "last_evaluated": None,
        "last_notified": None,
        "confirmed_at": None,
        "confirmed_by": None,
        "last_error": None,
        "last_event": None,
    }


def ensure_alert_state(
    state: dict[str, Any],
    alert: dict[str, Any],
) -> dict[str, Any]:
    """Return existing runtime state for an alert or create defaults."""

    alert_state = state["alerts"].setdefault(alert["id"], new_alert_state())
    for key, value in new_alert_state().items():
        alert_state.setdefault(key, value)
    return alert_state


def notification_due(
    notification: dict[str, Any],
    state: dict[str, Any],
) -> bool:
    """Determine whether a repeated notification is due."""

    repeat = notification.get("repeat")
    confirmation = notification.get("confirmation", {})

    if (
        not repeat
        and state.get("confirmation_action_id")
        and confirmation.get("enabled", False)
    ):
        repeat = {
            "interval": confirmation.get("resend_interval"),
            "max_attempts": confirmation.get("max_attempts", 5),
        }

    if not repeat or not repeat.get("enabled", True):
        return False

    attempts = int(state.get("attempts", 0))
    max_attempts = int(repeat.get("max_attempts", 1))

    if attempts >= max_attempts:
        return False

    last_notified = state.get("last_notified")

    if not last_notified:
        return True

    parsed = dt_util.parse_datetime(str(last_notified))

    if parsed is None:
        return True

    elapsed = dt_util.utcnow() - parsed
    interval = parse_duration(repeat["interval"])

    return elapsed >= interval