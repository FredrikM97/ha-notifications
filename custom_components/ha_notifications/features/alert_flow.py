"""Order the feature operations required by one alert event."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from ..const import HistoryEventType, StateRoot, TransitionKind
from ..controller.lifecycle import FeatureBase
from ..domain.notification import NotificationOutcome
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
                self.feature("history").record(
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
                self.feature("history").record(
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
                self.feature("history").record(
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
                    getattr(transition, "facts", None),
                    transition.source,
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
                    alert["id"], result.confirmation.confirmed_by, result.now
                )
            if result.record_history:
                self.feature("history").record(
                    alert,
                    HistoryEventType.CONFIRMED,
                    "Notification confirmed.",
                    result.confirmation.history_details(),
                    result.now,
                )

            delivery = await notification.ConfirmationDeliveryPlanner(
                alert,
                result.confirmation,
                result.now,
            ).build(self._render_template)
            if delivery.clear_notification:
                await self.feature("notification").clear(alert, result.now)
            if delivery.completion_alert is not None:
                await self._send_completion(delivery.completion_alert, result)

            actions = self.feature("confirmation").follow_up_actions(alert)
            await self.feature("follow_up_actions").run(
                alert,
                1,
                result.now,
                result.test,
                result.record_history,
                actions,
                result.confirmation,
            )
            self._runtime_storage.persist()

    async def _prepare_confirmation(
        self, alert: dict[str, Any], runtime: dict[str, Any], now: datetime
    ) -> None:
        confirmation_feature = self.feature("confirmation")
        await confirmation_feature.prepare_action(alert, runtime, now=now)

    async def _send_notification(
        self,
        alert: dict[str, Any],
        runtime: dict[str, Any],
        replace_existing: bool,
        now: datetime,
        condition_facts: dict[str, bool] | None = None,
        trigger_source: str = "",
    ) -> None:
        feature = self.feature("notification")
        alerts = self.feature("alerts")
        attempt = alerts.next_attempt(str(alert["id"]))
        pending_actions = self.feature("confirmation").pending_actions(
            alert, runtime
        )
        notification_actions = pending_actions.notification_actions()
        outcome = await feature.send_alert(
            alert,
            attempt=attempt,
            now=now,
            replace_existing=replace_existing,
            notification_actions=notification_actions,
            condition_facts=condition_facts,
            trigger_source=trigger_source,
        )
        self._record_notification_delivery(alert, outcome)
        if not outcome.success:
            return
        await self.feature("follow_up_actions").run(
            alert, attempt, now, False, True
        )

    def _record_notification_delivery(
        self,
        alert: dict[str, Any],
        outcome: NotificationOutcome,
    ) -> None:
        """Apply the ordered delivery outcome to its owning feature boundaries."""

        self.feature("alerts").record_delivery_result(
            str(alert["id"]),
            outcome.attempt,
            outcome.now,
            success=outcome.success,
            error=outcome.error,
        )
        self.feature("history").record_notification_outcome(
            alert,
            success=outcome.success,
            attempt=outcome.attempt,
            now=outcome.now,
            error=outcome.error,
        )

    async def _render_template(
        self, source: str, variables: dict[str, Any] | None = None
    ) -> Any:
        return await render_template(self._hass, source, variables)

    async def _send_completion(
        self,
        completion_alert: dict[str, Any],
        result: confirmation.ConfirmationResult,
    ) -> None:
        try:
            await self.feature("notification").send_completion(
                completion_alert,
                now=result.now,
                test=result.test,
            )
        except Exception as err:
            if result.record_history:
                self.feature("history").record_completion_outcome(
                    result.alert,
                    success=False,
                    error=str(err),
                    now=result.now,
                )
        else:
            if result.record_history:
                self.feature("history").record_completion_outcome(
                    result.alert,
                    success=True,
                    now=result.now,
                )