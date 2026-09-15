"""Feature-owned saved and draft notification test routes."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any
from uuid import uuid4

import voluptuous as vol

from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from .configuration import Alert
from .confirmation import DRAFT_SESSION_TTL, confirmation_for_alert


def _required_alert_id(value: Any) -> str:
    """Give invalid saved-test requests a command-specific validation error."""

    if not isinstance(value, str) or not value.strip():
        raise vol.Invalid("testing.saved requires a non-empty alert_id")
    return value


class TestFeature(FeatureBase):
    """Coordinate explicitly requested test delivery without owning sessions."""

    name = "testing"
    dependencies = ("alerts", "confirmation", "notification")

    @websocket_route(
        "testing.saved",
        command="test",
        arguments=(
            WebsocketArgument(
                "alert_id",
                _required_alert_id,
            ),
        ),
        error_code="test_failed",
        error_message="Unable to send test notification.",
    )
    async def test_saved(self, alert_id: str) -> bool:
        """Send one saved alert as a test."""

        alert_feature = self.feature("alerts")
        alert = await alert_feature.get_alert(alert_id)
        if alert is None:
            raise ValueError(f"Unknown alert: {alert_id}")
        action_id = await self._prepare_test_action(alert)
        await self.feature("notification").send(
            {
                "alert": alert,
                "attempt": 1,
                "confirmation_action_id": action_id,
                "replace_existing": False,
                "test": True,
                "now": self.services.gateway.now_utc(),
            }
        )
        return True

    async def _prepare_test_action(self, alert: dict[str, Any]) -> str | None:
        confirmation = confirmation_for_alert(alert)
        if confirmation is None or not confirmation.enabled:
            return None
        runtime = self.feature("alerts").runtime(alert["id"])
        action_id = f"NC_TEST_CONFIRM_{uuid4().hex}"
        runtime["confirmation_action_id"] = action_id
        await self.feature("confirmation").track(
            action_id,
            now=self.services.gateway.now_utc(),
            alert_id=alert["id"],
        )
        return action_id

    @websocket_route(
        "testing.payload",
        command="test_payload",
        arguments=(WebsocketArgument("alert", dict),),
        error_code="test_failed",
        error_message="Unable to send test notification.",
    )
    async def test_payload(self, alert: dict[str, Any]) -> dict[str, str | None]:
        """Send an unsaved editor draft without modifying saved state."""

        draft_alert = Alert.model_validate(alert).model_dump(exclude_none=True)
        sessions = await self._create_draft(draft_alert)
        await self.feature("notification").send(
            {
                "alert": {**draft_alert, "id": sessions["session_id"]},
                "attempt": 1,
                "confirmation_action_id": sessions["confirmation_action_id"],
                "replace_existing": False,
                "test": True,
                "now": self.services.gateway.now_utc(),
            }
        )
        return sessions

    async def _create_draft(self, alert: dict[str, Any]) -> dict[str, str | None]:
        now = self.services.gateway.now_utc()
        session_id = f"NC_DRAFT_{uuid4().hex}"
        draft_alert = {**alert, "id": session_id}
        await self.feature("confirmation").track(
            session_id,
            now=now,
            draft_alert=draft_alert,
            ttl=DRAFT_SESSION_TTL,
        )
        scheduler = self.services.scheduler
        if scheduler is None:
            raise RuntimeError("Test scheduler is unavailable")
        scheduler.schedule(self._expire_draft(session_id, now + DRAFT_SESSION_TTL))

        action_id = None
        confirmation = confirmation_for_alert(draft_alert)
        if confirmation and confirmation.enabled:
            action_id = f"NC_DRAFT_CONFIRM_{uuid4().hex}"
            await self.feature("confirmation").track(
                action_id,
                now=now,
                draft_alert=draft_alert,
                ttl=DRAFT_SESSION_TTL,
            )
        return {"session_id": session_id, "confirmation_action_id": action_id}

    async def _expire_draft(self, session_id: str, expires_at: datetime) -> None:
        seconds = max(
            0, (expires_at - self.services.gateway.now_utc()).total_seconds()
        )
        await asyncio.sleep(seconds)
        await self.discard_payload(session_id)

    @websocket_route(
        "testing.discard_payload",
        command="discard_test_payload",
        arguments=(WebsocketArgument("session_id", str),),
        error_code="discard_failed",
        error_message="Unable to discard test payload.",
    )
    async def discard_payload(self, session_id: str) -> bool:
        """Dispose a draft and any confirmation action bound to it."""

        now = self.services.gateway.now_utc()
        sessions = self.services.sessions
        stale_ids = [
            key
            for key, session in sessions.items()
            if session.expires_at and session.expires_at <= now
        ]
        related_ids = [session_id]
        related_ids.extend(
            key
            for key, session in sessions.items()
            if session.draft_alert and session.draft_alert.get("id") == session_id
        )
        for key in {*stale_ids, *related_ids}:
            await self.feature("confirmation").clear(key)
        return True
