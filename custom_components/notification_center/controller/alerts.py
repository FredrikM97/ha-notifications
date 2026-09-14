"""Pure alert-trigger watcher: the active/acknowledged/repeat state machine.

Replaces `runtime/engine.py` + `runtime/state.py`. Operates on a plain
`states` dict (`{alert_id: {...}}`) that `controller/core.py` loads from
storage and hands in on every call - this module never persists anything
and never calls Home Assistant itself. `register_specs()` says what to
watch; `on_condition_result()` says what happened and what `core.py` should
do about it via the returned `TriggerTransition`. `core.py` decides how to
turn that into sends/clears/history by calling
`controller/notifications.py` and `controller/actions.py` - this module
never calls them itself.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from ..const import TransitionKind
from ..domain.condition_schema import compile_condition
from ..domain.durations import parse_duration
from .commands import Command, TrackInterval, TrackTemplate

# ----------------------------------------------------------------------
# Runtime state (was runtime/state.py)
# ----------------------------------------------------------------------


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


def ensure_runtime_state(
    states: dict[str, Any], alert: dict[str, Any]
) -> dict[str, Any]:
    """Return existing runtime state for an alert or create defaults."""

    alert_state = states.setdefault(alert["id"], new_alert_state())
    for key, value in new_alert_state().items():
        alert_state.setdefault(key, value)
    return alert_state


def _notification_due(
    notification: dict[str, Any], state: dict[str, Any], now: datetime
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

    try:
        parsed = datetime.fromisoformat(str(last_notified))
    except ValueError:
        return True

    interval = parse_duration(repeat["interval"])
    if interval is None:
        return True

    return (now - parsed) >= interval


# ----------------------------------------------------------------------
# Watch specs (was AlertEngine.setup_alert's listener wiring)
# ----------------------------------------------------------------------


def register_specs(alert: dict[str, Any]) -> list[Command]:
    """Return the Commands needed to start watching one alert."""

    commands: list[Command] = []
    monitor = alert["monitor"]

    if monitor.get("on_change", True):
        commands.append(TrackTemplate(alert["id"], compile_condition(alert)))

    interval = _watch_interval(alert)
    if interval is not None:
        commands.append(TrackInterval(alert["id"], interval))

    return commands


def _watch_interval(alert: dict[str, Any]) -> timedelta | None:
    """Resolve the interval an alert should be periodically re-checked on.

    Falls back: explicit monitor interval, then the repeat interval (if
    repeats are enabled), then the confirmation resend interval (if
    confirmations are enabled) - same order as the original engine.
    """

    monitor = alert["monitor"]
    notification = alert["notification"]
    confirmation = notification.get("confirmation", {})
    repeat = notification.get("repeat")

    interval = monitor.get("interval")

    if not interval and isinstance(repeat, dict) and repeat.get("enabled", True):
        interval = repeat.get("interval")

    if not interval and confirmation.get("enabled", False):
        interval = confirmation.get("resend_interval")

    if not interval:
        return None

    return parse_duration(interval)


# ----------------------------------------------------------------------
# Trigger decisions (was AlertEngine.process_condition and friends)
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class TriggerTransition:
    """What happened to one alert's condition, and what `core.py` should do."""

    kind: TransitionKind
    error: str | None = None
    source: str = ""
    replace_existing: bool = False
    had_pending_confirmation: bool = False
    attempt: int = 0
    confirmation_action_id: str | None = None
    new_confirmation_action: bool = False


def on_condition_result(
    states: dict[str, Any],
    alert: dict[str, Any],
    active: bool | None,
    error: str | None,
    now: datetime,
    *,
    source: str,
) -> TriggerTransition:
    """Process one condition result and drive the active/repeat state machine."""

    if error is not None:
        return TriggerTransition(
            kind=TransitionKind.CONDITION_ERROR, error=error, source=source
        )

    state = ensure_runtime_state(states, alert)
    state["last_evaluated"] = now.isoformat()

    if not active:
        return _handle_inactive(state, source)

    if not state.get("active", False):
        return _handle_newly_active(state, now, alert, source)

    if state.get("acknowledged", False):
        return TriggerTransition(kind=TransitionKind.NO_CHANGE, source=source)

    attempts = int(state.get("attempts", 0))
    has_sent = bool(state.get("last_notified") or attempts)
    monitor = alert.get("monitor", {})

    if source == "startup" and monitor.get("startup", True) and not has_sent:
        return _should_send(state, alert, source, replace_existing=False)

    if source == "enabled" and not has_sent:
        return _should_send(state, alert, source, replace_existing=False)

    if source in ("reload", "startup", "interval") and _notification_due(
        alert["notification"], state, now
    ):
        return _should_send(state, alert, source, replace_existing=True)

    return TriggerTransition(kind=TransitionKind.NO_CHANGE, source=source)


def _handle_inactive(state: dict[str, Any], source: str) -> TriggerTransition:
    if not state.get("active", False):
        return TriggerTransition(kind=TransitionKind.NO_CHANGE, source=source)

    had_pending_confirmation = bool(state.get("confirmation_action_id"))

    state["active"] = False
    state["acknowledged"] = False
    state["attempts"] = 0
    state["confirmation_action_id"] = None
    state["notification_id"] = None
    state["flow_id"] = None

    return TriggerTransition(
        kind=TransitionKind.BECAME_INACTIVE,
        source=source,
        had_pending_confirmation=had_pending_confirmation,
    )


def _handle_newly_active(
    state: dict[str, Any],
    now: datetime,
    alert: dict[str, Any],
    source: str,
) -> TriggerTransition:
    state["active"] = True
    state["acknowledged"] = False
    state["attempts"] = 0
    state["started_at"] = now.isoformat()
    state["notification_id"] = (
        f"notification_center_{alert['id']}_{uuid.uuid4().hex[:10]}"
    )

    _ensure_flow_id(state, alert)
    new_action, action_id = _ensure_confirmation_action(state, alert)

    return TriggerTransition(
        kind=TransitionKind.BECAME_ACTIVE,
        source=source,
        attempt=int(state.get("attempts", 0)) + 1,
        confirmation_action_id=action_id,
        new_confirmation_action=new_action,
    )


def _should_send(
    state: dict[str, Any],
    alert: dict[str, Any],
    source: str,
    *,
    replace_existing: bool,
) -> TriggerTransition:
    _ensure_flow_id(state, alert)
    new_action, action_id = _ensure_confirmation_action(state, alert)

    return TriggerTransition(
        kind=TransitionKind.SHOULD_SEND,
        source=source,
        replace_existing=replace_existing,
        attempt=int(state.get("attempts", 0)) + 1,
        confirmation_action_id=action_id,
        new_confirmation_action=new_action,
    )


def _ensure_flow_id(state: dict[str, Any], alert: dict[str, Any]) -> str:
    flow_id = state.get("flow_id")
    if not flow_id:
        flow_id = f"flow_{alert['id']}_{uuid.uuid4().hex[:8]}"
        state["flow_id"] = flow_id
    return str(flow_id)


def _ensure_confirmation_action(
    state: dict[str, Any], alert: dict[str, Any]
) -> tuple[bool, str | None]:
    """Ensure an active confirmation alert has a pending action ID.

    Returns ``(newly_created, action_id)`` - `core.py` only needs to tell
    `controller/responses.py` about the action when it was newly created.
    """

    confirmation = alert["notification"].get("confirmation", {})
    if not confirmation.get("enabled", False):
        return False, None

    existing = state.get("confirmation_action_id")
    if existing:
        return False, existing

    action_id = f"NC_CONFIRM_{alert['id']}_{uuid.uuid4().hex}"
    state["confirmation_action_id"] = action_id
    return True, action_id


def record_send_result(
    states: dict[str, Any],
    alert: dict[str, Any],
    attempt: int,
    now: datetime,
    *,
    success: bool,
    error: str | None = None,
) -> None:
    """Record the outcome of a send attempt `core.py` just executed."""

    state = ensure_runtime_state(states, alert)

    if not success:
        state["last_error"] = error
        return

    state["attempts"] = attempt
    state["last_notified"] = now.isoformat()
    state["last_error"] = None


def clear_confirmation_action(states: dict[str, Any], alert: dict[str, Any]) -> None:
    """Clear a resolved confirmation's pending action ID (post-confirmation)."""

    state = ensure_runtime_state(states, alert)
    state["confirmation_action_id"] = None


def mark_confirmed(
    states: dict[str, Any],
    alert: dict[str, Any],
    confirmed_by: str,
    now: datetime,
) -> None:
    """Mark an alert acknowledged after a confirmation action is received."""

    state = ensure_runtime_state(states, alert)
    state["acknowledged"] = True
    state["confirmation_action_id"] = None
    state["confirmed_at"] = now.isoformat()
    state["confirmed_by"] = confirmed_by
