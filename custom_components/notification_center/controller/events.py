"""Shared Event vocabulary published/subscribed on the controller's EventBus.

Plain data only - no Home Assistant import. Feature modules import the
string constants below (a shared vocabulary, like `commands.py`) so a typo
in an event name is a `NameError` at import time instead of a silent
no-op subscription mismatch.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Event:
    """One fact broadcast on the bus; `payload` is plain data."""

    type: str
    payload: dict[str, Any] = field(default_factory=dict)


# ----------------------------------------------------------------------
# Fact events - published via EventBus.publish(), 0..N subscribers each
# ----------------------------------------------------------------------

CONDITION_CHECK_REQUESTED = "condition.check_requested"
CONDITION_EVALUATED = "condition.evaluated"
CONDITION_ERROR = "condition.error"
CONDITION_ACTIVE = "condition.active"
CONDITION_INACTIVE = "condition.inactive"
ALERT_CONFIGURED = "alert.configured"

NOTIFICATION_SEND_REQUESTED = "notification.send_requested"
NOTIFICATION_CLEAR_REQUESTED = "notification.clear_requested"
NOTIFICATION_SENT = "notification.sent"
NOTIFICATION_FAILED = "notification.failed"
COMPLETION_SENT = "notification.completion_sent"
COMPLETION_FAILED = "notification.completion_failed"

ACTION_RECEIVED = "action.received"
CONFIRMED = "alert.confirmed_fact"
ALERT_CONFIRMED = "alert.confirmed_effects"
CONFIRMATION_SESSION_STARTED = "confirmation.session_started"
CONFIRMATION_SESSION_DISCARD_REQUESTED = "confirmation.session_discard_requested"

ACTIONS_RUN_REQUESTED = "actions.run_requested"
ACTION_EXECUTED = "action.executed"
ACTION_FAILED = "action.failed"

NOTIFICATION_TEST_SENT = "notification.test_sent"

# ----------------------------------------------------------------------
# Query names - used via EventBus.ask(). RENDER_TEMPLATE/HAS_SERVICE/
# FETCH_REGISTRY_SNAPSHOT/EVALUATE_CONDITION are pure passthroughs answered
# by `ha/gateway.py` directly (EVALUATE_CONDITION's payload is
# ``{"source": str}``, a compiled condition template - the asker resolves
# the alert and compiles it first). The rest are answered by `core.py`,
# which owns the in-memory alert/runtime/session state.
# ----------------------------------------------------------------------

GET_ALERT = "get_alert"
GET_RUNTIME_STATE = "get_runtime_state"
GET_STATE = "get_state"
GET_SESSIONS = "get_sessions"
RENDER_TEMPLATE = "render_template"
HAS_SERVICE = "has_service"
FETCH_REGISTRY_SNAPSHOT = "fetch_registry_snapshot"
EVALUATE_CONDITION = "evaluate_condition"
GET_STATES = "get_states"
