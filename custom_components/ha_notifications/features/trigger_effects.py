"""Apply the ordered effects produced by the triggering feature."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..const import EVENT_RUNTIME_PERSIST_REQUESTED, HistoryEventType, TransitionKind
from . import history


class TriggerEffectCoordinator:
    """Keep delivery, history, and persistence out of trigger decisions."""

    def __init__(
        self,
        *,
        state: dict[str, Any],
        runtime_for: Any,
        confirmation: Any,
        notification: Any,
        follow_up_actions: Any,
        hass: Any,
        record_send_result: Any,
    ) -> None:
        self._state = state
        self._runtime_for = runtime_for
        self._confirmation = confirmation
        self._notification = notification
        self._follow_up_actions = follow_up_actions
        self._hass = hass
        self._record_send_result = record_send_result

    async def apply(
        self, alert: dict[str, Any], transition: Any, now: datetime
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
            history.record_notification_outcome(
                self._state,
                alert,
                success=False,
                attempt=transition.attempt,
                now=now,
                error=str(err),
            )
            self._persist()
            return
        self._record_send_result(runtime, transition.attempt, now, success=True)
        history.record_notification_outcome(
            self._state,
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
        if history.record_event(
            self._state,
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