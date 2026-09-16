"""Feature-owned saved and draft notification test routes."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import uuid4

import voluptuous as vol
from homeassistant.helpers.event import async_call_later
from homeassistant.util import dt as dt_util

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

    def __init__(self, hass: Any, *_args: Any) -> None:
        super().__init__(hass, *_args)
        self._hass = hass
        self._draft_callbacks: dict[str, Callable[[], None]] = {}

    async def on_unload(self) -> None:
        for cancel in self._draft_callbacks.values():
            cancel()
        self._draft_callbacks.clear()

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
            now=dt_util.utcnow(),
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
                "now": dt_util.utcnow(),
            }
        )
        return sessions

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
            lambda _now: self._expire_draft(session_id),
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
        await self.feature("confirmation").discard_draft(session_id, now)
        return True
