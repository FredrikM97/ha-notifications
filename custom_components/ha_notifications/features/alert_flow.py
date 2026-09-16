"""Order the feature operations required by one alert event."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from ..const import HistoryEventType, StateRoot, TransitionKind
from ..controller.lifecycle import FeatureBase
from ..support.storage import RuntimeStateStorage
from ..support.templates import render_template
from . import confirmation, notification


class AlertFlow(FeatureBase):
    """Coordinate ordered alert effects without owning feature decisions."""

    name = "alert_flow"
    dependencies = (
        "alerts",
        "confirmation",
        "notification",
        "follow_up_actions",
        "history",
    )

    def __init__(
        self,
        hass: Any,
        _state: StateRoot,
        _config_storage: Any,
        runtime_storage: RuntimeStateStorage,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._runtime_storage = runtime_storage
        self._locks: dict[str, asyncio.Lock] = {}

    async def on_unload(self) -> None:
        self._locks.clear()

    async def handle_condition(
        self,
        alert: Mapping[str, Any],
        transition: Any,
        now: datetime,
    ) -> None:
        """Apply the ordered effects for one condition transition."""

        alert_id = str(alert["id"])
        lock = self._locks.setdefault(alert_id, asyncio.Lock())
        async with lock:
            runtime = self.feature("alerts").runtime(alert_id)
            if transition.kind == TransitionKind.CONDITION_ERROR:
                self.feature("history").record_event(
                    runtime,
                    dict(alert),
                    HistoryEventType.CONDITION_ERROR,
                    "Template evaluation failed.",
                    {
                        "error": getattr(transition, "error", None),
                        "source": getattr(transition, "source", ""),
                    },
                    now,
                )
            elif transition.kind == TransitionKind.BECAME_INACTIVE:
                if transition.had_pending_confirmation:
                    await self.feature("notification").clear(
                        dict(alert), now
                    )
                self.feature("history").record_event(
                    runtime,
                    dict(alert),
                    HistoryEventType.CONDITION_INACTIVE,
                    "Condition became false.",
                    {"source": transition.source},
                    now,
                )
            elif transition.kind in (
                TransitionKind.BECAME_ACTIVE,
                TransitionKind.SHOULD_SEND,
            ):
                await self._prepare_confirmation(dict(alert), runtime, now)
                self.feature("history").record_event(
                    runtime,
                    dict(alert),
                    HistoryEventType.CONDITION_ACTIVE,
                    "Condition became true.",
                    {"source": transition.source},
                    now,
                )
                await self._send_notification(
                    dict(alert),
                    runtime,
                    transition.kind == TransitionKind.SHOULD_SEND,
                    now,
                )
            else:
                return
            self._runtime_storage.persist()

    async def handle_confirmation(
        self, result: confirmation.ConfirmationResult
    ) -> None:
        """Apply the ordered effects for one resolved confirmation."""

        alert = result.alert
        lock = self._locks.setdefault(str(alert["id"]), asyncio.Lock())
        async with lock:
            if not result.test:
                self.feature("alerts").acknowledge(
                    alert["id"], result.confirmed_by, result.now
                )
            if result.record_history:
                self.feature("history").record(
                    alert,
                    HistoryEventType.CONFIRMED,
                    "Notification confirmed.",
                    {"confirmed_by": result.confirmed_by},
                    result.now,
                )

            delivery = await notification.ConfirmationDeliveryPlanner(
                alert,
                result.confirmed_by,
                result.now,
            ).build(self._render_template)
            if delivery.clear_notification:
                await self.feature("notification").clear(alert, result.now)
            if delivery.completion_alert is not None:
                await self._send_completion(delivery.completion_alert, result)

            settings = confirmation.confirmation_for_alert(alert)
            actions = []
            if settings and settings.actions.enabled:
                actions = settings.actions.items
            await self.feature("follow_up_actions").run(
                alert,
                1,
                result.now,
                result.test,
                result.record_history,
                actions,
                result.confirmed_by,
            )
            self._runtime_storage.persist()

    async def _prepare_confirmation(
        self, alert: dict[str, Any], runtime: dict[str, Any], now: datetime
    ) -> None:
        confirmation_feature = self.feature("confirmation")
        created, action_id = await confirmation_feature.prepare_action(
            alert, runtime
        )
        if created and action_id:
            await confirmation_feature.track(
                action_id,
                now=now,
                alert_id=str(alert["id"]),
            )

    async def _send_notification(
        self,
        alert: dict[str, Any],
        runtime: dict[str, Any],
        replace_existing: bool,
        now: datetime,
    ) -> None:
        feature = self.feature("notification")
        attempt = feature.next_attempt(runtime)
        action_id = runtime.get("confirmation_action_id")
        try:
            await feature.send(
                {
                    "alert": alert,
                    "attempt": attempt,
                    "confirmation_action_id": action_id,
                    "replace_existing": replace_existing,
                    "test": False,
                    "now": now,
                }
            )
        except Exception as err:
            feature.record_delivery_result(
                runtime, attempt, now, success=False, error=str(err)
            )
            self.feature("history").record_notification_outcome(
                alert,
                success=False,
                attempt=attempt,
                now=now,
                error=str(err),
            )
            return

        feature.record_delivery_result(runtime, attempt, now, success=True)
        self.feature("history").record_notification_outcome(
            alert,
            success=True,
            attempt=attempt,
            now=now,
        )
        runtime["_notification_succeeded"] = True
        await self.feature("follow_up_actions").run(
            alert, attempt, now, False, True
        )
        runtime.pop("_notification_succeeded", None)

    async def _render_template(
        self, source: str, variables: dict[str, Any] | None = None
    ) -> Any:
        return await render_template(self._hass, source, variables)

    async def _send_completion(
        self,
        completion_alert: dict[str, Any],
        result: confirmation.ConfirmationResult,
    ) -> None:
        alert = result.alert
        try:
            await self.feature("notification").send(
                {
                    "alert": completion_alert,
                    "attempt": 1,
                    "confirmation_action_id": None,
                    "replace_existing": False,
                    "test": result.test,
                    "now": result.now,
                }
            )
        except Exception as err:
            if result.record_history:
                self.feature("history").record(
                    alert,
                    HistoryEventType.COMPLETION_FAILED,
                    "Completion notification failed.",
                    {"error": str(err)},
                    result.now,
                )
        else:
            if result.record_history:
                self.feature("history").record(
                    alert,
                    HistoryEventType.COMPLETION_SENT,
                    "Completion notification sent.",
                    {},
                    result.now,
                )