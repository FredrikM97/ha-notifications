"""Order the feature operations required by one alert event."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any

from ..const import AlertEventType, StateRoot
from ..controller.lifecycle import FeatureBase
from ..domain.service_calls import ServiceEffectsRequest
from ..domain.workflow import (
    ClearNotificationEffect,
    ConditionActiveEvent,
    ConditionErrorEvent,
    ConditionInactiveEvent,
    ConditionWorkflowEvent,
    NotificationClearRequest,
    NotificationOutcome,
    NotificationRequest,
    PersistEffect,
    SendNotificationEffect,
    ServiceEffectsEffect,
    WorkflowEffect,
    WorkflowEvent,
)
from ..support.storage import Storage


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
        "confirmations",
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
        self._plans: dict[str, AlertWorkflowPlan] = {}

    async def on_setup(self) -> None:
        self._plans = {
            alert.id: build_workflow_plan({"id": alert.id})
            for alert in self.feature("alerts").alerts.values()
        }

    async def on_unload(self) -> None:
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
        self, event: ConditionWorkflowEvent
    ) -> None:
        """Accept a classified condition workflow event."""

        await self.handle_event(event)

    async def handle_event(self, event: WorkflowEvent) -> None:
        """Dispatch one typed workflow event to its ordered effect path."""

        if isinstance(event, ConditionWorkflowEvent):
            await self._handle_condition(event)

    async def _handle_condition(self, event: ConditionWorkflowEvent) -> None:
        """Run the operation selected by the condition feature."""

        alert = event.alert
        self._ensure_plan(alert)
        runtime = self._state.setdefault("runtime", {}).setdefault(
            str(alert["id"]), {}
        )
        self.feature("confirmations").expire_stale(runtime, event.now)
        effects = self._exhaustion_effects(alert, runtime, event.now)
        if isinstance(event, ConditionErrorEvent):
            self._handle_condition_error(event)
        elif isinstance(event, ConditionInactiveEvent):
            await self.feature("alerts").deactivate(
                event.alert, event.now, event.source
            )
        elif isinstance(event, ConditionActiveEvent):
            self._handle_condition_active(event, effects)
        else:
            return
        await self._flush_effects(effects)

    def _exhaustion_effects(
        self,
        alert: Mapping[str, Any],
        runtime: dict[str, Any],
        now: datetime,
    ) -> list[WorkflowEffect]:
        """Expire exhausted confirmations and return their clear effect."""

        exhaustion = self.feature("confirmations").expire_exhausted(
            alert, runtime
        )
        if exhaustion is None:
            return []
        self.feature("alerts").publish_event(
            alert,
            AlertEventType.CONFIRMATION_ATTEMPTS_EXHAUSTED,
            "Confirmation attempts exhausted; notification cleared.",
            {
                "attempts": exhaustion.attempts,
                "max_attempts": exhaustion.max_attempts,
            },
            now,
        )
        return [
            ClearNotificationEffect(NotificationClearRequest(alert, now))
        ]

    def _handle_condition_error(self, event: ConditionErrorEvent) -> None:
        """Publish a condition evaluation error."""

        self.feature("alerts").publish_event(
            event.alert,
            AlertEventType.CONDITION_ERROR,
            "Template evaluation failed.",
            {"error": event.error, "source": event.source},
            event.now,
        )
    def _handle_condition_active(
        self,
        event: ConditionActiveEvent,
        effects: list[WorkflowEffect],
    ) -> None:
        """Queue notification and follow-up effects for an active alert."""

        alert = event.alert
        runtime = self._state.setdefault("runtime", {}).setdefault(
            str(alert["id"]), {}
        )
        if not self._should_notify(alert, runtime, event.source, event.now):
            return
        self.feature("confirmations").prepare_action(
            alert, runtime, now=event.now
        )
        effects.extend(
            (
                SendNotificationEffect(
                    NotificationRequest(
                        alert,
                        None,
                        event.now,
                        event.replace_existing,
                        condition_facts=event.facts,
                        trigger_source=event.source,
                    )
                ),
                ServiceEffectsEffect(ServiceEffectsRequest(alert, event.now)),
            )
        )

    def _should_notify(
        self,
        alert: Mapping[str, Any],
        runtime: Mapping[str, Any],
        source: str,
        now: datetime,
    ) -> bool:
        """Apply trigger policy before queuing notification effects."""

        if source == "startup" and (alert.get("monitor") or {}).get(
            "startup", True
        ):
            return not runtime.get("last_notified")
        if source == "startup":
            return False
        if source == "enabled" and not runtime.get("last_notified"):
            return True
        if source not in ("reload", "startup", "interval", "confirmation"):
            return False
        if runtime.get("acknowledged", False):
            return False
        return bool(
            self.feature("confirmations").reminder_due(
                alert, dict(runtime), now
            )
        )

    async def _flush_effects(self, effects: list[WorkflowEffect]) -> None:
        """Run queued effects and persist when a workflow made changes."""

        if not effects:
            return
        effects.append(PersistEffect())
        await self._execute_effects(effects)


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

    async def _send_notification(
        self,
        request: NotificationRequest,
    ) -> NotificationOutcome:
        feature = self.feature("notification")
        confirmation_feature = self.feature("confirmations")
        runtime = self._state.setdefault("runtime", {}).setdefault(
            str(request.alert["id"]), {}
        )
        pending_actions = self.feature("confirmations").pending_actions(
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
        self.feature("alerts").publish_event(
            alert,
            AlertEventType.NOTIFICATION_SENT
            if outcome.success
            else AlertEventType.NOTIFICATION_FAILED,
            "Notification sent." if outcome.success else "Notification failed.",
            details,
            outcome.now,
        )
