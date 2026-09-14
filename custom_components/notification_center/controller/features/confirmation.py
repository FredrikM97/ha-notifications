"""Track confirmation sessions and route response events."""

from __future__ import annotations

from copy import deepcopy
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from ..rendering import Render, render_value

DRAFT_SESSION_TTL = timedelta(minutes=15)


def track(
    sessions: dict[str, dict[str, Any]],
    session_id: str,
    *,
    now: datetime,
    alert_id: str | None = None,
    draft_alert: dict[str, Any] | None = None,
    ttl: timedelta | None = None,
) -> None:
    """Start tracking one pending confirmation session.

    Real alerts pass ``alert_id``; unsaved editor test payloads pass
    ``draft_alert`` (a deep copy is kept so later edits in the editor don't
    change what a confirmation button replies to) and get a TTL so an
    abandoned draft eventually stops accepting confirmations.
    """

    sessions[session_id] = {
        "alert_id": alert_id,
        "draft_alert": deepcopy(draft_alert) if draft_alert is not None else None,
        "created_at": now,
        "expires_at": (now + ttl) if draft_alert is not None and ttl else None,
    }


def clear(sessions: dict[str, dict[str, Any]], session_id: str) -> None:
    """Stop tracking one pending confirmation session."""

    sessions.pop(session_id, None)


def expire_drafts(sessions: dict[str, dict[str, Any]], now: datetime) -> list[str]:
    """Remove draft sessions whose TTL has passed; return the removed IDs.

    Real-alert sessions never have an ``expires_at`` and are unaffected -
    they end when the alert's condition clears or gets confirmed instead.
    """

    expired = [
        session_id
        for session_id, session in sessions.items()
        if session.get("expires_at") and session["expires_at"] <= now
    ]
    for session_id in expired:
        sessions.pop(session_id, None)

    return expired


# ----------------------------------------------------------------------
# Incoming mobile-action event routing (was ConfirmationActionHandler)
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class ResponseOutcome:
    """One resolved confirmation-button press, ready for `core.py` to act on."""

    session_id: str
    alert_id: str | None
    draft_alert: dict[str, Any] | None

    @property
    def is_draft(self) -> bool:
        return self.draft_alert is not None


@dataclass(frozen=True)
class ConfirmationEffects:
    """Actions selected by the confirmation feature after acknowledgement."""

    clear_notification: bool
    completion_alert: dict[str, Any] | None
    follow_up_actions: list[dict[str, Any]]


async def execute_confirmation_effects(
    alert: dict[str, Any],
    confirmed_by: str,
    now: datetime,
    render: Render,
    *,
    clear_notification: Callable[[], Awaitable[None]],
    send_completion: Callable[[dict[str, Any]], Awaitable[None]],
    run_follow_up_actions: Callable[
        [list[dict[str, Any]], dict[str, Any]], Awaitable[None]
    ],
) -> None:
    """Execute feature-selected effects through injected runtime callbacks."""

    effects = await plan_confirmation_effects(alert, confirmed_by, now, render)
    if effects.clear_notification:
        await clear_notification()
    if effects.completion_alert is not None:
        await send_completion(effects.completion_alert)
    if effects.follow_up_actions:
        await run_follow_up_actions(
            effects.follow_up_actions,
            {
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "alert_active": True,
                "confirmed_by": confirmed_by,
                "now": now,
            },
        )


def extract_action_id(event_data: Any) -> str | None:
    """Return the confirmation action ID from a mobile-action event payload."""

    if not isinstance(event_data, dict):
        return None

    action = event_data.get("action")
    return str(action) if action else None


def match_action_event(
    sessions: dict[str, dict[str, Any]],
    event_data: Any,
    now: datetime,
) -> ResponseOutcome | None:
    """Resolve an incoming mobile-action event to a pending session, if any."""

    action_id = extract_action_id(event_data)
    if not action_id:
        return None

    expire_drafts(sessions, now)

    session = sessions.get(action_id)
    if session is None:
        return None

    return ResponseOutcome(
        action_id, session.get("alert_id"), session.get("draft_alert")
    )


# ----------------------------------------------------------------------
# Person name resolution
# ----------------------------------------------------------------------


def resolve_person_name(person_states: list[Any], user_id: str | None) -> str:
    """Resolve a Home Assistant user ID to a person's display name."""

    if not user_id:
        return "Unknown user"

    for state in person_states:
        if state.attributes.get("user_id") == user_id:
            return state.name

    return "Unknown user"


# ----------------------------------------------------------------------
# Completion notification (was ConfirmationSupport._build_completion_alert)
# ----------------------------------------------------------------------


async def build_completion_alert(
    alert: dict[str, Any],
    confirmed_by: str,
    now: datetime,
    render: Render,
) -> dict[str, Any] | None:
    """Build the synthetic "completion" alert sent after a confirmation.

    Returns ``None`` when nothing is configured to send - the caller skips
    sending in that case.
    """

    notification = alert["notification"]
    confirmation = notification.get("confirmation", {})
    if not confirmation.get("notify_on_confirmation", False):
        return None

    completion_message = confirmation.get("completion_message") or ""

    completion_message = (
        confirmation.get("confirmation_message")
        or completion_message
        or "{{ confirmed_by }} confirmed this notification."
    )

    if not completion_message:
        return None

    completion_alert = deepcopy(alert)
    completion_alert["notification"] = deepcopy(notification)
    completion_alert["notification"]["message"] = await render_value(
        render,
        completion_message,
        {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "confirmed_by": confirmed_by,
            "now": now,
        },
    )
    completion_alert["notification"]["confirmation"] = {"enabled": False}

    return completion_alert


async def plan_confirmation_effects(
    alert: dict[str, Any],
    confirmed_by: str,
    now: datetime,
    render: Render,
) -> ConfirmationEffects:
    """Decide confirmation side effects without executing them."""

    confirmation = alert["notification"].get("confirmation", {})
    completion_alert = await build_completion_alert(alert, confirmed_by, now, render)
    actions = confirmation.get("actions", [])
    if not isinstance(actions, list):
        actions = []

    return ConfirmationEffects(
        clear_notification=confirmation.get("clear_on_confirmation", True),
        completion_alert=completion_alert,
        follow_up_actions=actions if confirmation.get("actions_enabled", False) else [],
    )
