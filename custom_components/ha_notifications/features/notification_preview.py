"""Feature-owned saved and editor notification preview routes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any
from uuid import uuid4

import voluptuous as vol
from homeassistant.helpers.event import async_call_later
from homeassistant.util import dt as dt_util

from ..const import EVENT_ALERT_EVENT, EVENT_NOTIFICATION_ACTION, AlertEventType
from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from ..domain.confirmation import (
    ConfirmationActionSet,
    ConfirmationContext,
    ConfirmationSelection,
)
from ..domain.service_calls import ServiceEffectsRequest
from ..domain.workflow import NotificationRequest
from ..support.jinja import JinjaEvaluator
from .configuration import Alert
from .notification import ConfirmationDeliveryPlanner
from .response_actions import (
    ConfirmationConfig,
    extract_action_id,
    resolve_confirmed_by,
)

PREVIEW_SESSION_TTL = timedelta(minutes=15)


def _required_alert_id(value: Any) -> str:
    """Give invalid saved-test requests a command-specific validation error."""

    if not isinstance(value, str) or not value.strip():
        raise vol.Invalid(
            "notification_preview.saved requires a non-empty alert_id"
        )
    return value


@dataclass
class PreviewSession:
    alert: dict[str, Any]
    action_ids: dict[str, str] = field(default_factory=dict)
    reminder_attempts: int = 1
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

    @property
    def primary_action_id(self) -> str | None:
        """Return the first action for reminder and expiry scheduling."""

        return next(iter(self.action_ids), None)


class NotificationPreviewFeature(FeatureBase):
    """Coordinate explicitly requested notification previews."""

    name = "notification_preview"
    dependencies = (
        "alerts",
        "history",
        "response_actions",
        "notification",
        "follow_up_actions",
    )

    def __init__(
        self,
        hass: Any,
        _state: Any,
        _config_storage: Any,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._jinja = JinjaEvaluator.for_hass(hass)
        self._sessions: dict[str, PreviewSession] = {}
        self._unsubscribe: Callable[[], None] | None = None

    async def on_setup(self) -> None:
        self._unsubscribe = self._hass.bus.async_listen(
            EVENT_NOTIFICATION_ACTION, self._on_preview_action
        )

    async def on_unload(self) -> None:
        if self._unsubscribe:
            self._unsubscribe()
            self._unsubscribe = None
        for session in self._sessions.values():
            session.cancel_timers()
        self._sessions.clear()

    async def _on_preview_action(self, event: Any) -> None:
        action_id = extract_action_id(event.data)
        if not action_id:
            return
        session_item = next(
            (
                (session_id, session)
                for session_id, session in self._sessions.items()
                if action_id in session.action_ids
            ),
            None,
        )
        if session_item is None:
            return
        session_id, session = session_item
        now = dt_util.utcnow()
        user_id = event.context.user_id if event.context else None
        confirmed_by = await resolve_confirmed_by(
            self._hass,
            self._hass.states.async_all("person"),
            user_id,
        )
        selection = next(
            item
            for item in self.feature("response_actions").selections_for(
                session.alert, session.action_ids
            )
            if item.action_id == action_id
        )
        context = ConfirmationContext(confirmed_by, selection)
        self._hass.bus.async_fire(
            EVENT_ALERT_EVENT,
            {
                "id": uuid4().hex,
                "timestamp": now.isoformat(),
                "alert_id": session.alert["id"],
                "alert_name": session.alert["name"],
                "type": AlertEventType.CONFIRMED.value,
                "message": "Notification confirmed.",
                "details": {
                    "confirmed_by": confirmed_by,
                    "response_id": selection.response_id,
                    "response": selection.label,
                },
            },
        )
        delivery = await ConfirmationDeliveryPlanner(
            session.alert, context, now
        ).build(self._jinja.render)
        if delivery.clear_notification:
            await self.feature("notification").clear(session.alert, now)
        if delivery.completion_alert is not None:
                await self.feature("notification").send(
                    NotificationRequest(
                        alert=delivery.completion_alert,
                        attempt=1,
                        now=now,
                        replace_existing=False,
                    )
                )
        actions = self.feature("follow_up_actions").actions_for_confirmation(
            session.alert
        )
        await self.feature("follow_up_actions").execute(
            ServiceEffectsRequest(
                session.alert,
                now,
                attempt=1,
                actions=tuple(actions),
                confirmation=context,
            )
        )
        self._remove_session(session_id)

    @websocket_route(
        "notification_preview.saved",
        command="preview",
        arguments=(
            WebsocketArgument(
                "alert_id",
                _required_alert_id,
            ),
        ),
        error_code="preview_failed",
        error_message="Unable to send test notification.",
    )
    async def preview_saved(self, alert_id: str) -> bool:
        """Send one saved alert as a notification preview."""

        alert_feature = self.feature("alerts")
        alert = await alert_feature.get_alert(alert_id)
        if alert is None:
            raise ValueError(f"Unknown alert: {alert_id}")
        action_ids = await self._prepare_preview_action(alert)
        notification_actions = self._notification_actions(alert, action_ids)
        try:
            await self._send_preview_notification(alert, notification_actions)
        except Exception:
            for pending_action_id in action_ids:
                self.feature("response_actions").clear(pending_action_id)
            raise
        if action_ids:
            self._register_preview_session(
                next(iter(action_ids)),
                alert,
                action_ids,
                expires_action=True,
            )
        return True

    async def _prepare_preview_action(
        self, alert: dict[str, Any]
    ) -> dict[str, str]:
        return self._action_ids_for(alert, "NC_PREVIEW_CONFIRM")

    @staticmethod
    def _action_ids_for(alert: dict[str, Any], prefix: str) -> dict[str, str]:
        settings = ConfirmationConfig.from_alert(alert)
        if settings is None or not settings.enabled:
            return {}
        return {
            f"{prefix}_{uuid4().hex}_{button.id}": button.id
            for button in settings.buttons
        }

    @staticmethod
    def _notification_actions(
        alert: dict[str, Any], action_ids: dict[str, str]
    ) -> list[dict[str, str]]:
        settings = ConfirmationConfig.from_alert(alert)
        labels = {}
        if settings is not None:
            labels = {button.id: button.label for button in settings.buttons}
        selections = tuple(
            ConfirmationSelection(
                action_id,
                response_id,
                labels.get(response_id, "Done"),
            )
            for action_id, response_id in action_ids.items()
        )
        return ConfirmationActionSet(selections).notification_actions()

    @websocket_route(
        "notification_preview.payload",
        command="preview_payload",
        arguments=(WebsocketArgument("alert", dict),),
        error_code="preview_failed",
        error_message="Unable to send test notification.",
    )
    async def preview_payload(self, alert: dict[str, Any]) -> dict[str, str]:
        """Send an editor payload without modifying saved state."""

        preview_alert = Alert.model_validate(alert).model_dump(exclude_none=True)
        session = await self._create_preview_session(preview_alert)
        try:
            await self._send_preview_notification(
                {**preview_alert, "id": session["session_id"]},
                self._notification_actions(
                    preview_alert,
                    self._sessions[session["session_id"]].action_ids,
                ),
            )
        except Exception:
            await self.discard_preview(session["session_id"])
            raise
        self._register_preview_session(
            session["session_id"],
            {**preview_alert, "id": session["session_id"]},
            self._sessions[session["session_id"]].action_ids,
        )
        return session

    def _register_preview_session(
        self,
        session_id: str,
        alert: dict[str, Any],
        action_ids: dict[str, str],
        *,
        expires_action: bool = False,
    ) -> None:
        """Track and schedule attempts for a saved or editor preview."""

        session = self._sessions.setdefault(
            session_id,
            PreviewSession(
                alert=alert,
                action_ids=action_ids,
            ),
        )
        session.alert = alert
        session.action_ids = action_ids
        session.reminder_attempts = 1
        if expires_action and action_ids:
            session.action_expiry_cancel = self._schedule(
                PREVIEW_SESSION_TTL,
                lambda: self._expire_preview_action(
                    session_id, session.action_ids
                ),
            )
        self._schedule_reminder(session_id)

    async def _send_preview_notification(
        self,
        alert: dict[str, Any],
        notification_actions: list[dict[str, str]],
        *,
        attempt: int = 1,
        replace_existing: bool = False,
    ) -> None:
        outcome = await self.feature("notification").send(
            NotificationRequest(
                alert=alert,
                attempt=attempt,
                notification_actions=tuple(notification_actions),
                replace_existing=replace_existing,
                now=dt_util.utcnow(),
            )
        )
        if not outcome.success:
            raise RuntimeError(outcome.error or "Test notification failed.")
        now = outcome.now
        self._hass.bus.async_fire(
            EVENT_ALERT_EVENT,
            {
                "id": uuid4().hex,
                "timestamp": now.isoformat(),
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "type": AlertEventType.TEST.value,
                "message": "Test notification sent.",
                "details": {},
            },
        )

    def _schedule(
        self,
        delay: timedelta,
        operation: Callable[[], Awaitable[None]],
    ) -> Callable[[], None]:
        """Run an async operation from Home Assistant's sync timer callback."""

        def start_operation(_now: Any) -> Any:
            return self._hass.add_job(operation())

        return async_call_later(
            self._hass,
            delay,
            start_operation,
        )

    async def _create_preview_session(
        self, alert: dict[str, Any]
    ) -> dict[str, str]:
        session_id = f"NC_PREVIEW_{uuid4().hex}"
        preview_alert = {**alert, "id": session_id}
        action_ids = self._action_ids_for(alert, "NC_PREVIEW_CONFIRM")
        self._sessions[session_id] = PreviewSession(
            alert=preview_alert,
            action_ids=action_ids,
            session_expiry_cancel=self._schedule(
                PREVIEW_SESSION_TTL, lambda: self._expire_session(session_id)
            ),
        )
        return {"session_id": session_id}

    async def _expire_session(self, session_id: str) -> None:
        await self.discard_preview(session_id)

    def _schedule_reminder(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        confirmation = ConfirmationConfig.from_alert(session.alert)
        if (
            confirmation is None
            or not confirmation.enabled
            or not confirmation.reminders.enabled
        ):
            return
        interval = (
            timedelta(seconds=float(confirmation.reminders.interval))
            if confirmation.reminders.interval is not None
            else None
        )
        if interval is None or session.reminder_attempts >= int(
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
        confirmation = ConfirmationConfig.from_alert(session.alert)
        current_attempt = session.reminder_attempts
        max_attempts = (
            int(confirmation.reminders.max_attempts or 1)
            if confirmation
            else 1
        )
        if confirmation is None or current_attempt >= max_attempts:
            return
        try:
            await self._send_preview_notification(
                session.alert,
                self._notification_actions(session.alert, session.action_ids),
                attempt=current_attempt + 1,
                replace_existing=True,
            )
        except Exception:
            self._schedule_reminder(session_id)
            return
        session.reminder_attempts = current_attempt + 1
        self._schedule_reminder(session_id)

    async def _expire_preview_action(
        self, session_id: str, action_ids: dict[str, str]
    ) -> None:
        self._remove_session(session_id)
        for action_id in action_ids:
            self.feature("response_actions").clear(action_id)

    @websocket_route(
        "notification_preview.discard",
        command="discard_preview",
        arguments=(WebsocketArgument("session_id", str),),
        error_code="discard_failed",
        error_message="Unable to discard test payload.",
    )
    async def discard_preview(self, session_id: str) -> bool:
        """Dispose a preview and its confirmation actions."""

        session = self._sessions.get(session_id)
        self._remove_session(session_id)
        for action_id in session.action_ids if session else ():
            self.feature("response_actions").clear(action_id)
        if session and session.alert["id"].startswith("NC_PREVIEW_"):
            await self.feature("history").remove_alert(session.alert["id"])
        return True

    def _remove_session(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session:
            session.cancel_timers()
