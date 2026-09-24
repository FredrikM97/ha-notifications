"""Order the feature operations required by one alert event."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..const import AlertEventType, FeatureName, WorkflowSource
from ..controller.lifecycle import FeatureBase
from ..domain.runtime import AlertRuntimeState
from ..domain.service_calls import FollowUpActionsRequest
from ..domain.workflow import (
    ConditionStatus,
    ConditionWorkflowEvent,
    NotificationOutcome,
    NotificationRequest,
)
from ..support.storage import Storage
from .configuration import monitor_config


class AlertFlow(FeatureBase):
    """Coordinate direct ordered operations for condition-triggered alerts."""

    name = "alert_flow"
    dependencies = (
        "alerts",
        "confirmations",
        "notification",
        "follow_up_actions",
    )

    def __init__(
        self,
        _hass: Any,
        _runtime: dict[str, AlertRuntimeState],
        _config_storage: Any,
        _storage: Storage,
    ) -> None:
        super().__init__()
        self._startup_attempted_flows: dict[str, str] = {}

    async def handle_event(self, event: ConditionWorkflowEvent) -> None:
        """Run the operation selected by the condition feature."""

        runtime = event.runtime
        self.feature(FeatureName.CONFIRMATIONS).expire_stale(runtime, event.now)
        await self._clear_exhausted_confirmation(runtime)
        if event.status is ConditionStatus.ERROR:
            self._handle_condition_error(event)
        elif event.status is ConditionStatus.INACTIVE:
            await self.feature(FeatureName.ALERTS).deactivate(
                runtime, event.now, event.source
            )
        elif event.status is ConditionStatus.ACTIVE:
            await self._handle_condition_active(event)
        else:
            return

    async def _clear_exhausted_confirmation(
        self,
        runtime: AlertRuntimeState,
    ) -> None:
        """Clear a notification when confirmation attempts are exhausted."""

        exhaustion = self.feature(FeatureName.CONFIRMATIONS).expire_exhausted(
            runtime
        )
        if exhaustion is None:
            return
        self.feature(FeatureName.ALERTS).publish_event(
            runtime,
            AlertEventType.CONFIRMATION_ATTEMPTS_EXHAUSTED,
            "Confirmation attempts exhausted; notification cleared.",
            {
                "attempts": exhaustion.attempts,
                "max_attempts": exhaustion.max_attempts,
            },
        )
        await self.feature(FeatureName.NOTIFICATION).clear(runtime)

    def _handle_condition_error(self, event: ConditionWorkflowEvent) -> None:
        """Publish a condition evaluation error."""

        self.feature(FeatureName.ALERTS).publish_event(
            event.runtime,
            AlertEventType.CONDITION_ERROR,
            "Template evaluation failed.",
            {"error": event.error or "Unknown condition error", "source": event.source},
        )

    async def _handle_condition_active(
        self, event: ConditionWorkflowEvent
    ) -> None:
        """Send an active alert and run follow-up actions after success."""

        runtime = event.runtime
        if not self._should_notify(runtime, event.source, event.now):
            return
        if event.source == WorkflowSource.STARTUP and runtime.flow_id:
            self._startup_attempted_flows[str(runtime.config["id"])] = runtime.flow_id
        self.feature(FeatureName.CONFIRMATIONS).prepare_action(runtime)
        outcome = await self._send_notification(event)
        if outcome.success:
            await self.feature(FeatureName.FOLLOW_UP_ACTIONS).execute(
                FollowUpActionsRequest(runtime)
            )

    def _should_notify(
        self,
        runtime: AlertRuntimeState,
        source: WorkflowSource,
        now: datetime,
    ) -> bool:
        """Apply trigger policy before queuing notification effects."""

        alert = runtime.config
        if source == WorkflowSource.TEST:
            return True
        if source == WorkflowSource.STARTUP:
            return self._should_notify_on_startup(runtime, alert)
        if source == WorkflowSource.ENABLED and not runtime.last_notified:
            return True
        if source not in (
            WorkflowSource.CHANGE,
            WorkflowSource.RELOAD,
            WorkflowSource.INTERVAL,
            WorkflowSource.CONFIRMATION,
        ):
            return False
        if runtime.acknowledged:
            return False
        return bool(
            self.feature(FeatureName.CONFIRMATIONS).reminder_due(
                runtime, now
            )
        )

    def _should_notify_on_startup(
        self, runtime: AlertRuntimeState, alert: dict[str, Any]
    ) -> bool:
        """Allow one startup delivery for an alert activation."""

        flow_id = runtime.flow_id
        if (
            monitor_config(alert).startup is False
            or not flow_id
            or runtime.last_notified
        ):
            return False
        return self._startup_attempted_flows.get(str(alert["id"])) != flow_id

    async def _send_notification(
        self,
        event: ConditionWorkflowEvent,
    ) -> NotificationOutcome:
        feature = self.feature(FeatureName.NOTIFICATION)
        confirmation_feature = self.feature(FeatureName.CONFIRMATIONS)
        runtime = event.runtime
        pending_actions = confirmation_feature.pending_actions(runtime)
        attempt = runtime.confirmation.next_attempt
        notification_actions = [
            {"action": selection.action_id, "title": selection.label}
            for selection in pending_actions
        ]
        outcome = await feature.send(
            NotificationRequest(
                runtime=runtime,
                replace_existing=event.replace_existing,
                notification_actions=tuple(notification_actions),
                condition_facts=event.facts,
                trigger_source=event.source,
            )
        )
        runtime.state["last_error"] = outcome.error
        if outcome.success:
            runtime.state["last_notified"] = outcome.now.isoformat()
            runtime.state["last_error"] = None
        runtime.record_event(outcome)
        details: dict[str, Any] = {
            "attempt": attempt,
            "success": outcome.success,
        }
        if not outcome.success:
            details["error"] = outcome.error
        self.feature(FeatureName.ALERTS).publish_event(
            runtime,
            AlertEventType.NOTIFICATION_SENT
            if outcome.success
            else AlertEventType.NOTIFICATION_FAILED,
            "Notification sent." if outcome.success else "Notification failed.",
            details,
        )
        if not outcome.success:
            return outcome
        if pending_actions:
            confirmation_feature.record_attempt(runtime)
        return outcome
