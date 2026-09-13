"""Draft notification confirmation session tracking."""

from __future__ import annotations

import uuid
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any


@dataclass(frozen=True)
class DraftDelivery:
    """Prepared draft notification delivery state."""

    alert: dict[str, Any]
    expires_at: datetime


class DraftConfirmationSessions:
    """Track editor draft confirmation actions independently of runtime state."""

    def __init__(self, ttl: timedelta) -> None:
        self.ttl = ttl
        self.sessions: dict[str, datetime] = {}
        self.actions: dict[str, dict[str, Any]] = {}

    def create(
        self,
        alert: dict[str, Any],
        now: datetime,
    ) -> DraftDelivery:
        """Create an isolated draft delivery alert with a temporary session ID."""

        self.expire(now)
        session_id = f"NC_DRAFT_{uuid.uuid4().hex}"
        delivery_alert = deepcopy(alert)
        delivery_alert["id"] = session_id
        expires_at = now + self.ttl
        self.sessions[session_id] = expires_at

        return DraftDelivery(delivery_alert, expires_at)

    def register_action(
        self,
        action_id: str,
        session_id: str,
        alert: dict[str, Any],
    ) -> None:
        """Associate a confirmation action with one draft session."""

        self.actions[action_id] = {
            "session_id": session_id,
            "alert": alert,
        }

    def resolve_action(self, action_id: str) -> dict[str, Any] | None:
        """Return the draft confirmation payload for an action."""

        return self.actions.get(action_id)

    def expire(self, now: datetime) -> None:
        """Discard draft sessions whose confirmation window has expired."""

        for session_id, expires_at in list(self.sessions.items()):
            if expires_at <= now:
                self.discard(session_id)

    def discard(self, session_id: str) -> None:
        """Remove all temporary confirmation actions for one draft session."""

        self.sessions.pop(session_id, None)
        for action_id, draft in list(self.actions.items()):
            if draft["session_id"] == session_id:
                self.actions.pop(action_id, None)