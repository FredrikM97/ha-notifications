"""Feature-owned saved and draft notification test routes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import uuid4

import voluptuous as vol
from homeassistant.helpers.event import async_call_later
from homeassistant.util import dt as dt_util

from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from ..domain.durations import parse_duration
from .configuration import Alert
from .confirmation import DRAFT_SESSION_TTL, confirmation_for_alert


def _required_alert_id(value: Any) -> str:
    """Give invalid saved-test requests a command-specific validation error."""

    if not isinstance(value, str) or not value.strip():
        raise vol.Invalid("testing.saved requires a non-empty alert_id")
    return value


@dataclass
class TestSession:
    alert: dict[str, Any]
    action_id: str | None
    attempts: int = 1
    session_expiry_cancel: Callable[[], None] | None = None
    reminder_cancel: Callable[[], None] | None = None
    action_expiry_cancel: Callable[[], None] | None = None

    def cancel_timers(self) -> None:
        for cancel in (
            self.session_expiry_cancel,
            self.reminder_cancel,
            self.action_expiry_cancel,
        ):
            if cancel:
                cancel()


class TestFeature(FeatureBase):
    """Coordinate explicitly requested test delivery without owning sessions."""

    name = "testing"
    dependencies = ("alerts", "confirmation", "notification")

    def __init__(
        self,
        hass: Any,
        _state: Any,
        _config_storage: Any,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._sessions: dict[str, TestSession] = {}

    async def on_unload(self) -> None:
        for session in self._sessions.values():
            session.cancel_timers()
        self._sessions.clear()

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
        try:
            await self._send_test_notification(alert, action_id)
        except Exception:
            if action_id:
                await self.feature("confirmation").clear(action_id)
            raise
        if action_id:
            self._register_test_session(
                action_id, alert, action_id, expires_action=True
            )
        return True

    async def _prepare_test_action(self, alert: dict[str, Any]) -> str | None:
        confirmation = confirmation_for_alert(alert)
        if confirmation is None or not confirmation.enabled:
            return None
        action_id = f"NC_TEST_CONFIRM_{uuid4().hex}"
        await self.feature("confirmation").track(
            action_id,
            now=dt_util.utcnow(),
            draft_alert=alert,
            ttl=DRAFT_SESSION_TTL,
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
        session = await self._create_draft_session(draft_alert)
        try:
            await self._send_test_notification(
                {**draft_alert, "id": session["session_id"]},
                session["confirmation_action_id"],
            )
        except Exception:
            await self.discard_payload(session["session_id"])
            raise
        self._register_test_session(
            session["session_id"],
            {**draft_alert, "id": session["session_id"]},
            session["confirmation_action_id"],
        )
        return session

    def _register_test_session(
        self,
        session_id: str,
        alert: dict[str, Any],
        action_id: str | None,
        *,
        expires_action: bool = False,
    ) -> None:
        """Track and schedule attempts for a saved or draft test."""

        session = self._sessions.setdefault(
            session_id, TestSession(alert=alert, action_id=action_id)
        )
        session.alert = alert
        session.action_id = action_id
        session.attempts = 1
        if expires_action and action_id is not None:
            session.action_expiry_cancel = self._schedule(
                DRAFT_SESSION_TTL,
                lambda: self._expire_test_action(session_id, action_id),
            )
        self._schedule_reminder(session_id)

    async def _send_test_notification(
        self,
        alert: dict[str, Any],
        action_id: str | None,
        *,
        attempt: int = 1,
        replace_existing: bool = False,
    ) -> None:
        await self.feature("notification").send(
            {
                "alert": alert,
                "attempt": attempt,
                "confirmation_action_id": action_id,
                "replace_existing": replace_existing,
                "test": True,
                "now": dt_util.utcnow(),
            }
        )

    def _schedule(
        self,
        delay: timedelta,
        operation: Callable[[], Awaitable[None]],
    ) -> Callable[[], None]:
        """Run an async operation from Home Assistant's sync timer callback."""

        return async_call_later(
            self._hass,
            delay,
            lambda _now: self._hass.async_create_task(operation()),
        )

    async def _create_draft_session(
        self, alert: dict[str, Any]
    ) -> dict[str, str | None]:
        now = dt_util.utcnow()
        session_id = f"NC_DRAFT_{uuid4().hex}"
        draft_alert = {**alert, "id": session_id}
        await self.feature("confirmation").track(
            session_id,
            now=now,
            draft_alert=draft_alert,
            ttl=DRAFT_SESSION_TTL,
        )
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
        self._sessions[session_id] = TestSession(
            alert=draft_alert,
            action_id=action_id,
            session_expiry_cancel=self._schedule(
                DRAFT_SESSION_TTL, lambda: self._expire_session(session_id)
            ),
        )
        return {"session_id": session_id, "confirmation_action_id": action_id}

    async def _expire_session(self, session_id: str) -> None:
        await self.discard_payload(session_id)

    def _schedule_reminder(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        confirmation = confirmation_for_alert(session.alert)
        if (
            confirmation is None
            or not confirmation.enabled
            or not confirmation.reminders.enabled
        ):
            return
        interval = parse_duration(confirmation.reminders.interval)
        if interval is None or session.attempts >= int(
            confirmation.reminders.max_attempts or 1
        ):
            return
        if session.reminder_cancel:
            session.reminder_cancel()
        session.reminder_cancel = self._schedule(
            interval, lambda: self._send_reminder(session_id)
        )

    async def _send_reminder(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        session.reminder_cancel = None
        confirmation = confirmation_for_alert(session.alert)
        current_attempt = session.attempts
        max_attempts = (
            int(confirmation.reminders.max_attempts or 1)
            if confirmation
            else 1
        )
        action_id = session.action_id
        if action_id and not self.feature("confirmation").has_pending(action_id):
            self._remove_session(session_id)
            return
        if confirmation is None or current_attempt >= max_attempts:
            return
        try:
            await self._send_test_notification(
                session.alert,
                action_id,
                attempt=current_attempt + 1,
                replace_existing=True,
            )
        except Exception:
            self._schedule_reminder(session_id)
            return
        session.attempts = current_attempt + 1
        self._schedule_reminder(session_id)

    async def _expire_test_action(
        self, session_id: str, action_id: str
    ) -> None:
        self._remove_session(session_id)
        await self.feature("confirmation").clear(action_id)

    @websocket_route(
        "testing.discard_payload",
        command="discard_test_payload",
        arguments=(WebsocketArgument("session_id", str),),
        error_code="discard_failed",
        error_message="Unable to discard test payload.",
    )
    async def discard_payload(self, session_id: str) -> bool:
        """Dispose a draft and any confirmation action bound to it."""

        now = dt_util.utcnow()
        self._remove_session(session_id)
        await self.feature("confirmation").discard_draft(session_id, now)
        return True

    def _remove_session(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session:
            session.cancel_timers()
