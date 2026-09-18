"""Feature-owned saved and draft notification test routes."""

from __future__ import annotations

from collections.abc import Callable
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
        self._draft_callbacks: dict[str, Callable[[], None]] = {}
        self._reminder_callbacks: dict[str, Callable[[], None]] = {}
        self._test_expiry_callbacks: dict[str, Callable[[], None]] = {}
        self._draft_attempts: dict[str, int] = {}
        self._draft_alerts: dict[str, dict[str, Any]] = {}
        self._draft_action_ids: dict[str, str | None] = {}

    async def on_unload(self) -> None:
        for cancel in self._draft_callbacks.values():
            cancel()
        self._draft_callbacks.clear()
        for cancel in self._reminder_callbacks.values():
            cancel()
        self._reminder_callbacks.clear()
        for cancel in self._test_expiry_callbacks.values():
            cancel()
        self._test_expiry_callbacks.clear()
        self._draft_attempts.clear()
        self._draft_alerts.clear()
        self._draft_action_ids.clear()

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
                "now": dt_util.utcnow(),
            }
        )
        if action_id:
            self._register_test_reminders(action_id, alert, action_id)
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
        sessions = await self._create_draft(draft_alert)
        await self.feature("notification").send(
            {
                "alert": {**draft_alert, "id": sessions["session_id"]},
                "attempt": 1,
                "confirmation_action_id": sessions["confirmation_action_id"],
                "replace_existing": False,
                "test": True,
                "now": dt_util.utcnow(),
            }
        )
        self._register_test_reminders(
            sessions["session_id"],
            {**draft_alert, "id": sessions["session_id"]},
            sessions["confirmation_action_id"],
        )
        return sessions

    def _register_test_reminders(
        self,
        session_id: str,
        alert: dict[str, Any],
        action_id: str | None,
    ) -> None:
        """Track and schedule attempts for either kind of test notification."""

        self._draft_attempts[session_id] = 1
        self._draft_alerts[session_id] = alert
        self._draft_action_ids[session_id] = action_id
        if action_id == session_id:
            self._test_expiry_callbacks[session_id] = async_call_later(
                self._hass,
                DRAFT_SESSION_TTL,
                lambda _now: self._hass.async_create_task(
                    self._expire_test_action(session_id, action_id)
                ),
            )
        self._schedule_draft_reminder(session_id)

    async def _create_draft(self, alert: dict[str, Any]) -> dict[str, str | None]:
        now = dt_util.utcnow()
        session_id = f"NC_DRAFT_{uuid4().hex}"
        draft_alert = {**alert, "id": session_id}
        await self.feature("confirmation").track(
            session_id,
            now=now,
            draft_alert=draft_alert,
            ttl=DRAFT_SESSION_TTL,
        )
        self._draft_callbacks[session_id] = async_call_later(
            self._hass,
            DRAFT_SESSION_TTL,
            lambda _now: self._hass.async_create_task(
                self._expire_draft(session_id)
            ),
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
        return {"session_id": session_id, "confirmation_action_id": action_id}

    async def _expire_draft(self, session_id: str) -> None:
        await self.discard_payload(session_id)

    def _schedule_draft_reminder(self, session_id: str) -> None:
        alert = self._draft_alerts.get(session_id)
        if alert is None:
            return
        confirmation = confirmation_for_alert(alert)
        if (
            confirmation is None
            or not confirmation.enabled
            or not confirmation.reminders.enabled
        ):
            return
        interval = parse_duration(confirmation.reminders.interval)
        if interval is None or self._draft_attempts.get(session_id, 0) >= int(
            confirmation.reminders.max_attempts or 1
        ):
            return
        previous = self._reminder_callbacks.pop(session_id, None)
        if previous:
            previous()
        self._reminder_callbacks[session_id] = async_call_later(
            self._hass,
            interval,
            lambda _now: self._hass.async_create_task(
                self._send_draft_reminder(session_id)
            ),
        )

    async def _send_draft_reminder(self, session_id: str) -> None:
        self._reminder_callbacks.pop(session_id, None)
        alert = self._draft_alerts.get(session_id)
        if alert is None:
            return
        confirmation = confirmation_for_alert(alert)
        current_attempt = self._draft_attempts.get(session_id, 0)
        max_attempts = (
            int(confirmation.reminders.max_attempts or 1)
            if confirmation
            else 1
        )
        action_id = self._draft_action_ids.get(session_id)
        if action_id and not self.feature("confirmation").has_pending(action_id):
            self._draft_alerts.pop(session_id, None)
            self._draft_action_ids.pop(session_id, None)
            self._draft_attempts.pop(session_id, None)
            return
        if confirmation is None or current_attempt >= max_attempts:
            return
        try:
            await self.feature("notification").send(
                {
                    "alert": alert,
                    "attempt": current_attempt + 1,
                    "confirmation_action_id": action_id,
                    "replace_existing": True,
                    "test": True,
                    "now": dt_util.utcnow(),
                }
            )
        except Exception:
            self._schedule_draft_reminder(session_id)
            return
        self._draft_attempts[session_id] = current_attempt + 1
        self._schedule_draft_reminder(session_id)

    async def _expire_test_action(
        self, session_id: str, action_id: str
    ) -> None:
        self._test_expiry_callbacks.pop(session_id, None)
        cancel = self._reminder_callbacks.pop(session_id, None)
        if cancel:
            cancel()
        self._draft_attempts.pop(session_id, None)
        self._draft_alerts.pop(session_id, None)
        self._draft_action_ids.pop(session_id, None)
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
        cancel = self._draft_callbacks.pop(session_id, None)
        if cancel:
            cancel()
        reminder_cancel = self._reminder_callbacks.pop(session_id, None)
        if reminder_cancel:
            reminder_cancel()
        self._draft_attempts.pop(session_id, None)
        self._draft_alerts.pop(session_id, None)
        self._draft_action_ids.pop(session_id, None)
        await self.feature("confirmation").discard_draft(session_id, now)
        return True
