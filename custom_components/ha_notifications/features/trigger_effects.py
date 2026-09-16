"""Apply the ordered effects produced by the triggering feature."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import TYPE_CHECKING, Any, Protocol

from homeassistant.core import HomeAssistant

from ..const import (
    EVENT_RUNTIME_PERSIST_REQUESTED,
    HistoryEventType,
    TransitionKind,
)

if TYPE_CHECKING:
    from .triggering import TriggerTransition


class ConfirmationEffects(Protocol):
    async def track(
        self, session_id: str, *, now: datetime, alert_id: str
    ) -> None: ...


class NotificationEffects(Protocol):
    async def send(self, payload: dict[str, Any]) -> bool: ...

    async def clear(self, alert: dict[str, Any], now: datetime) -> None: ...


class FollowUpEffects(Protocol):
    async def run(
        self,
        alert: dict[str, Any],
        attempt: int,
        now: datetime,
        test: bool,
        record_history: bool,
    ) -> None: ...


class HistoryEffects(Protocol):
    def record_event(
        self,
        runtime_state: dict[str, Any] | None,
        alert: dict[str, Any],
        event_type: HistoryEventType,
        message: str,
        details: dict[str, Any],
        now: datetime,
    ) -> bool: ...

    def record_notification_outcome(
        self,
        alert: dict[str, Any],
        *,
        success: bool,
        attempt: int,
        now: datetime,
        error: str | None = None,
    ) -> bool: ...


class SendResultRecorder(Protocol):
    def __call__(
        self,
        runtime: dict[str, Any],
        attempt: int,
        now: datetime,
        *,
        success: bool,
        error: str | None = None,
    ) -> None: ...


class TriggerTransitionEffects:
    """Sequence feature effects after a trigger transition is decided."""

    def __init__(
        self,
        *,
        runtime_for: Callable[[str], dict[str, Any]],
        confirmation: ConfirmationEffects,
        notification: NotificationEffects,
        follow_up_actions: FollowUpEffects,
        history: HistoryEffects,
        hass: HomeAssistant,
        record_send_result: SendResultRecorder,
    ) -> None:
        self._runtime_for = runtime_for
        self._confirmation = confirmation
        self._notification = notification
        self._follow_up_actions = follow_up_actions
        self._history = history
        self._hass = hass
        self._record_send_result = record_send_result

    async def apply(
        self, alert: dict[str, Any], transition: TriggerTransition, now: datetime
    ) -> None:
        if transition.kind == TransitionKind.NO_CHANGE:
            return
        runtime = self._runtime_for(alert["id"])
        if transition.kind == TransitionKind.CONDITION_ERROR:
            self._record(
                runtime,
                alert,
                HistoryEventType.CONDITION_ERROR,
                "Template evaluation failed.",
                {"error": transition.error, "source": transition.source},
                now,
            )
            return
        if transition.kind == TransitionKind.BECAME_INACTIVE:
            if transition.had_pending_confirmation:
                await self._notification.clear(alert, now)
            self._record(
                runtime,
                alert,
                HistoryEventType.CONDITION_INACTIVE,
                "Condition became false.",
                {"source": transition.source},
                now,
            )
            return
        if transition.new_confirmation_action and transition.confirmation_action_id:
            await self._confirmation.track(
                transition.confirmation_action_id,
                now=now,
                alert_id=alert["id"],
            )
        self._record(
            runtime,
            alert,
            HistoryEventType.CONDITION_ACTIVE,
            "Condition became true.",
            {"source": transition.source},
            now,
        )
        try:
            await self._notification.send(
                {
                    "alert": alert,
                    "attempt": transition.attempt,
                    "confirmation_action_id": transition.confirmation_action_id,
                    "replace_existing": transition.replace_existing,
                    "test": False,
                    "now": now,
                }
            )
        except Exception as err:
            self._record_send_result(
                runtime, transition.attempt, now, success=False, error=str(err)
            )
            self._history.record_notification_outcome(
                alert,
                success=False,
                attempt=transition.attempt,
                now=now,
                error=str(err),
            )
            self._persist()
            return
        self._record_send_result(runtime, transition.attempt, now, success=True)
        self._history.record_notification_outcome(
            alert,
            success=True,
            attempt=transition.attempt,
            now=now,
        )
        await self._follow_up_actions.run(
            alert, transition.attempt, now, False, True
        )
        self._persist()

    def _record(
        self,
        runtime: dict[str, Any],
        alert: dict[str, Any],
        event_type: HistoryEventType,
        message: str,
        details: dict[str, Any],
        now: datetime,
    ) -> None:
        if self._history.record_event(
            runtime,
            alert,
            event_type,
            message,
            details,
            now,
        ):
            self._persist()

    def _persist(self) -> None:
        self._hass.bus.async_fire(EVENT_RUNTIME_PERSIST_REQUESTED)