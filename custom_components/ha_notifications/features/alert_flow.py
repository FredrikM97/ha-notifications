"""Order the feature operations required by one alert event."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any

from ..const import EVENT_ALERT_EVENT, AlertEventType, StateRoot
from ..controller.lifecycle import FeatureBase
from ..domain.runtime import AlertRuntimeState
from ..domain.service_calls import ServiceEffectsRequest
from ..domain.workflow import (
    ClearNotificationEffect,
    ConditionWorkflowEvent,
    ConfirmationWorkflowEvent,
    NotificationClearRequest,
    NotificationOutcome,
    NotificationRequest,
    PersistEffect,
    SendNotificationEffect,
    ServiceEffectsEffect,
    WorkflowEffect,
    WorkflowEvent,
)
from ..support.jinja import JinjaEvaluator
from ..support.storage import Storage
from . import notification, response_actions


class WorkflowPhase(str, Enum):
    """Ordered boundaries in one alert's application workflow."""

    CONDITION = "condition"
    CONFIRMATION = "confirmation"
    NOTIFICATION = "notification"
    SERVICE_EFFECTS = "service_effects"
    PERSISTENCE = "persistence"


@dataclass(frozen=True, slots=True)
class AlertWorkflowPlan:
    """Immutable phase plan built from one validated alert configuration."""

    alert_id: str
    phases: tuple[WorkflowPhase, ...]


WORKFLOW_PHASES = (
    WorkflowPhase.CONDITION,
    WorkflowPhase.CONFIRMATION,
    WorkflowPhase.NOTIFICATION,
    WorkflowPhase.SERVICE_EFFECTS,
    WorkflowPhase.PERSISTENCE,
)


def build_workflow_plan(alert: Mapping[str, Any]) -> AlertWorkflowPlan:
    """Build the canonical ordered phase plan for one alert."""

    return AlertWorkflowPlan(str(alert["id"]), WORKFLOW_PHASES)


class AlertFlow(FeatureBase):
    """Coordinate ordered alert effects without owning feature decisions."""

    name = "alert_flow"
    dependencies = (
        "alerts",
        "response_actions",
        "notification",
        "follow_up_actions",
    )

    def __init__(
        self,
        hass: Any,
        _state: StateRoot,
        _config_storage: Any,
        storage: Storage,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._state = _state
        self._storage = storage
        self._jinja = JinjaEvaluator.for_hass(hass)
        self._locks: dict[str, asyncio.Lock] = {}
        self._plans: dict[str, AlertWorkflowPlan] = {}

    async def on_setup(self) -> None:
        self._plans = {
            alert.id: build_workflow_plan({"id": alert.id})
            for alert in self.feature("alerts").alerts.values()
        }

    async def on_unload(self) -> None:
        self._locks.clear()
        self._plans.clear()

    def plan(self, alert_id: str) -> AlertWorkflowPlan:
        """Return the immutable plan for one configured alert."""

        try:
            return self._plans[alert_id]
        except KeyError as err:
            raise RuntimeError(
                f"No workflow plan exists for alert {alert_id}"
            ) from err

    def _ensure_plan(self, alert: Mapping[str, Any]) -> AlertWorkflowPlan:
        alert_id = str(alert["id"])
        plan = self._plans.get(alert_id)
        if plan is None:
            plan = build_workflow_plan(alert)
            self._plans[alert_id] = plan
        return plan

    async def handle_condition(
        self,
        alert: Mapping[str, Any],
        transition: Any,
        now: datetime,
    ) -> None:
        """Accept a condition callback at the feature boundary."""

        await self.handle_event(
            ConditionWorkflowEvent(
                alert, transition, now
            )
        )

    async def handle_confirmation(
        self, result: response_actions.ConfirmationResult
    ) -> None:
        """Accept a resolved response at the feature boundary."""

        await self.handle_event(
            ConfirmationWorkflowEvent(
                result.alert,
                result.confirmation,
                result.now,
            )
        )

    async def handle_event(self, event: WorkflowEvent) -> None:
        """Dispatch one typed workflow event to its ordered effect path."""

        if isinstance(event, ConditionWorkflowEvent):
            await self._handle_condition(event)
            return
        await self._handle_confirmation(event)

    async def _handle_condition(self, event: ConditionWorkflowEvent) -> None:
        """Apply the ordered effects for one condition transition."""

        alert = event.alert
        self._ensure_plan(alert)
        await self._handle_condition_locked(event)

    async def _handle_condition_locked(
        self, event: ConditionWorkflowEvent
    ) -> None:
        """Apply one condition event while preserving per-alert ordering."""

        alert = event.alert
        alert_id = str(alert["id"])
        runtime = self._state.setdefault("runtime", {}).setdefault(alert_id, {})
        runtime_state = AlertRuntimeState.from_runtime(runtime)
        evaluation = event.evaluation
        effects: list[WorkflowEffect] = []
        async with self._locks.setdefault(alert_id, asyncio.Lock()):
            if evaluation.error is not None:
                self._publish_event(
                    alert, AlertEventType.CONDITION_ERROR,
                    "Template evaluation failed.",
                    {"error": evaluation.error, "source": evaluation.source},
                    event.now,
                )
            elif evaluation.active is False:
                if not runtime.get("active", False):
                    return
                runtime_state.active = False
                runtime_state.acknowledged = False
                runtime_state.notification_id = None
                runtime_state.flow_id = None
                runtime_state.write_to(runtime)
                self._publish_event(
                    alert, AlertEventType.CONDITION_INACTIVE,
                    "Condition became false.",
                    {"source": evaluation.source},
                    event.now,
                )
            elif evaluation.active is True:
                was_active = bool(runtime.get("active", False))
                runtime_state.last_evaluated = event.now.isoformat()
                runtime_state.write_to(runtime)
                if not was_active:
                    runtime_state.active = True
                    runtime_state.acknowledged = False
                    runtime_state.started_at = event.now.isoformat()
                    runtime_state.notification_id = (
                        f"ha_notifications_{alert_id}_"
                        f"{uuid.uuid4().hex[:10]}"
                    )
                    runtime_state.flow_id = (
                        f"flow_{alert_id}_{uuid.uuid4().hex[:8]}"
                    )
                    runtime_state.write_to(runtime)
                elif runtime.get("acknowledged", False):
                    return
                elif not self._should_send(
                    alert, runtime, evaluation.source, event.now
                ):
                    return
                self._prepare_confirmation(
                    alert, runtime, event.now
                )
                if not was_active:
                    self._publish_event(
                        alert, AlertEventType.CONDITION_ACTIVE,
                        "Condition became true.",
                        {"source": evaluation.source},
                        event.now,
                    )
                effects.extend(
                    (
                        SendNotificationEffect(
                            NotificationRequest(
                                alert,
                                None,
                                event.now,
                                was_active,
                                condition_facts=(
                                    evaluation.facts or {}
                                ),
                                trigger_source=evaluation.source,
                            )
                        ),
                        ServiceEffectsEffect(
                            ServiceEffectsRequest(alert, event.now)
                        ),
                    )
                )
            else:
                return
            effects.append(PersistEffect())
            await self._execute_effects(effects)

    def _should_send(
        self,
        alert: Mapping[str, Any],
        runtime: Mapping[str, Any],
        source: str,
        now: datetime,
    ) -> bool:
        """Apply trigger policy after a condition evaluated true."""

        if source == "startup" and (alert.get("monitor") or {}).get(
            "startup", True
        ) and not runtime.get("last_notified"):
            return True
        if source == "enabled" and not runtime.get("last_notified"):
            return True
        if source not in ("reload", "startup", "interval", "confirmation"):
            return False
        response_actions = self.feature("response_actions")
        reminder_due = getattr(response_actions, "reminder_due", None)
        if reminder_due is None:
            return True
        return bool(reminder_due(alert, dict(runtime), now))

    async def _execute_effects(self, effects: list[WorkflowEffect]) -> None:
        """Execute typed effects in their declared order."""

        notification_outcome: NotificationOutcome | None = None
        for effect in effects:
            if isinstance(effect, ClearNotificationEffect):
                await self.feature("notification").clear(
                    effect.request.alert, effect.request.now
                )
            elif isinstance(effect, SendNotificationEffect):
                notification_outcome = await self._send_notification(
                    effect.request,
                )
            elif isinstance(effect, ServiceEffectsEffect):
                if (
                    notification_outcome is not None
                    and not notification_outcome.success
                ):
                    continue
                attempt = effect.attempt
                if attempt is None and notification_outcome is not None:
                    attempt = notification_outcome.attempt
                await self.feature("follow_up_actions").execute(
                    ServiceEffectsRequest(
                        effect.request.alert,
                        effect.request.now,
                        attempt=attempt,
                        actions=effect.request.actions,
                        confirmation=effect.request.confirmation,
                    )
                )
            elif isinstance(effect, PersistEffect):
                self._storage.persist()

    async def _handle_confirmation(
        self, event: ConfirmationWorkflowEvent
    ) -> None:
        """Apply the ordered effects for one resolved confirmation."""

        alert = event.alert
        self._ensure_plan(alert)
        lock = self._locks.setdefault(str(alert["id"]), asyncio.Lock())
        async with lock:
            self.feature("response_actions").acknowledge(
                alert["id"], event.confirmation.confirmed_by, event.now
            )
            self._publish_event(
                alert,
                AlertEventType.CONFIRMED,
                "Notification confirmed.",
                {
                    "confirmed_by": event.confirmation.confirmed_by,
                    "response_id": event.confirmation.selection.response_id,
                    "response": event.confirmation.selection.label,
                },
                event.now,
            )
            effects: list[WorkflowEffect] = []

            delivery = await notification.ConfirmationDeliveryPlanner(
                alert,
                event.confirmation,
                event.now,
            ).build(self._render_template)
            if delivery.clear_notification:
                effects.append(
                    ClearNotificationEffect(
                        NotificationClearRequest(alert, event.now)
                    )
                )
            await self._execute_effects(effects)

            if delivery.completion_alert is not None:
                await self._send_completion(delivery.completion_alert, event)

            actions = self.feature("follow_up_actions").actions_for_confirmation(
                alert
            )
            await self._execute_effects(
                [
                    ServiceEffectsEffect(
                        ServiceEffectsRequest(
                            alert,
                            event.now,
                            attempt=1,
                            actions=tuple(actions),
                            confirmation=event.confirmation,
                        )
                    )
                ]
            )
            self._storage.persist()

    def _prepare_confirmation(
        self, alert: Mapping[str, Any], runtime: dict[str, Any], now: datetime
    ) -> None:
        confirmation_feature = self.feature("response_actions")
        confirmation_feature.prepare_action(alert, runtime, now=now)

    async def _send_notification(
        self,
        request: NotificationRequest,
    ) -> NotificationOutcome:
        feature = self.feature("notification")
        confirmation_feature = self.feature("response_actions")
        runtime = self._state.setdefault("runtime", {}).setdefault(
            str(request.alert["id"]), {}
        )
        pending_actions = self.feature("response_actions").pending_actions(
            request.alert, runtime
        )
        attempt = (
            confirmation_feature.next_attempt(runtime)
            if pending_actions.selections
            else None
        )
        notification_actions = pending_actions.notification_actions()
        outcome = await feature.send(
            NotificationRequest(
                alert=request.alert,
                attempt=attempt,
                now=request.now,
                replace_existing=request.replace_existing,
                notification_actions=tuple(notification_actions),
                condition_facts=request.condition_facts,
                trigger_source=request.trigger_source,
            )
        )
        self._record_notification_delivery(request.alert, outcome)
        if not outcome.success:
            return outcome
        if pending_actions.selections:
            confirmation_feature.record_attempt(runtime)
        return outcome

    def _record_notification_delivery(
        self,
        alert: Mapping[str, Any],
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
        details: dict[str, Any] = {
            "attempt": outcome.attempt,
            "success": outcome.success,
        }
        if not outcome.success:
            details["error"] = outcome.error
        self._publish_event(
            alert,
            AlertEventType.NOTIFICATION_SENT
            if outcome.success
            else AlertEventType.NOTIFICATION_FAILED,
            "Notification sent." if outcome.success else "Notification failed.",
            details,
            outcome.now,
        )

    async def _render_template(
        self, source: str, variables: dict[str, Any] | None = None
    ) -> Any:
        return await self._jinja.render(source, variables)

    async def _send_completion(
        self,
        completion_alert: dict[str, Any],
        event: ConfirmationWorkflowEvent,
    ) -> None:
        try:
            outcome = await self.feature("notification").send(
                NotificationRequest(
                    alert=completion_alert,
                    attempt=1,
                    now=event.now,
                    replace_existing=False,
                )
            )
            if not outcome.success:
                raise RuntimeError(outcome.error or "completion notification failed")
        except Exception as err:
            self._publish_event(
                event.alert,
                AlertEventType.COMPLETION_FAILED,
                "Completion notification failed.",
                {"error": str(err)},
                event.now,
            )
        else:
            self._publish_event(
                event.alert,
                AlertEventType.COMPLETION_SENT,
                "Completion notification sent.",
                {},
                event.now,
            )

    def _publish_event(
        self,
        alert: Mapping[str, Any],
        event_type: AlertEventType,
        message: str,
        details: Mapping[str, Any],
        now: datetime,
    ) -> None:
        runtime = self._state.setdefault("runtime", {}).setdefault(
            str(alert["id"]), {}
        )
        self._hass.bus.async_fire(
            EVENT_ALERT_EVENT,
            {
                "id": uuid.uuid4().hex,
                "timestamp": now.isoformat(),
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "type": event_type.value,
                "message": message,
                "details": dict(details),
                "flow_id": runtime.get("flow_id"),
            },
        )