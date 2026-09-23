"""Tests for ordered alert effect orchestration."""

from __future__ import annotations

import importlib
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from custom_components.ha_notifications.domain.confirmation import (
    PendingConfirmationState,
)
from custom_components.ha_notifications.domain.runtime import AlertRuntimeState
from custom_components.ha_notifications.domain.workflow import (
    ConditionStatus,
    ConditionWorkflowEvent,
    NotificationOutcome,
    NotificationRequest,
)
from tests.backend.conftest import make_alert
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
module = importlib.import_module(f"{PACKAGE_NAME}.features.alert_flow")
const = importlib.import_module(f"{PACKAGE_NAME}.const")
confirmation_module = importlib.import_module(
    f"{PACKAGE_NAME}.features.confirmations"
)


def condition_event(alert, transition, now, runtime=None):
    runtime = runtime or AlertRuntimeState.for_alert(alert)
    runtime.alert = dict(alert)
    if getattr(transition, "error", None) is not None:
        return ConditionWorkflowEvent(
            runtime,
            transition.source,
            now,
            ConditionStatus.ERROR,
            error=transition.error,
        )
    if transition.active is False:
        return ConditionWorkflowEvent(
            runtime, transition.source, now, ConditionStatus.INACTIVE
        )
    return ConditionWorkflowEvent(
        runtime,
        transition.source,
        now,
        ConditionStatus.ACTIVE,
        facts=getattr(transition, "facts", {}) or {},
        replace_existing=runtime.active,
    )


class RuntimeAlerts:
    def __init__(self):
        self.notification = None
        self.history = None
        self.values = {
            "alert_1": AlertRuntimeState(
                alert=make_alert(),
                active=True, confirmation=PendingConfirmationState()
            )
        }

    def runtime(self, alert_or_id):
        if isinstance(alert_or_id, str):
            alert_id = alert_or_id
            alert = None
        else:
            alert = alert_or_id
            alert_id = str(alert["id"])
        runtime = self.values[alert_id]
        if alert is not None:
            runtime.alert = dict(alert)
        return runtime

    async def deactivate(self, runtime, now, _source):
        alert = runtime.alert
        if not runtime.active:
            return None
        runtime.active = False
        runtime.acknowledged = False
        runtime.flow_id = None
        monitor = alert.get("monitor") or {}
        configured = monitor.get("clear_on_condition_change")
        confirmation = alert.get("confirmation")
        clear_notification = (
            bool(configured)
            if configured is not None
            else confirmation is None or not confirmation.get("enabled", False)
        )
        if clear_notification and self.notification is not None:
            await self.notification.clear(alert)
        return True

    def publish_event(self, _runtime, event_type, message, details):
        if self.history is None:
            return
        self.history.append_event(
            {
                "alert_id": _runtime.alert["id"],
                "type": event_type.value,
                "message": message,
                "details": dict(details),
                "timestamp": "event-time",
            }
        )

    def acknowledge(self, *_args):
        return None

    def next_attempt(self, alert_id):
        return self.values[alert_id].confirmation.attempts + 1

    def record_delivery_result(self, runtime, now, *, success, error=None):
        if not success:
            runtime.last_error = error
            return
        runtime.last_notified = now.isoformat()
        runtime.last_error = None


class History:
    def __init__(self, order=None):
        self.events = []
        self.order = order

    def append_event(self, data):
        if self.order is not None:
            self.order.append(
                "notification_outcome"
                if data["type"]
                in (
                    const.AlertEventType.NOTIFICATION_SENT,
                    const.AlertEventType.NOTIFICATION_FAILED,
                )
                else "history"
            )
        self.events.append(
            (
                None,
                data["alert_id"],
                const.AlertEventType(data["type"]),
                data["message"],
                data["details"],
                data["timestamp"],
            )
        )
        return True


class Notification:
    def __init__(self, *, fail=False, order=None):
        self.fail = fail
        self.sent = []
        self.cleared = []
        self.order = order

    async def send(self, request):
        if self.order is not None:
            self.order.append("notification")
        self.sent.append(
            {
                "alert": dict(request.runtime.alert),
                "attempt": (
                    request.runtime.confirmation.next_attempt
                ),
                "notification_actions": list(request.notification_actions),
                "replace_existing": request.replace_existing,
                "now": datetime.now(timezone.utc),
                "condition_facts": dict(request.condition_facts),
                "trigger_source": request.trigger_source,
            }
        )
        if self.fail:
            return NotificationOutcome(
                datetime.now(timezone.utc),
                False,
                "delivery failed",
            )
        return NotificationOutcome(
            datetime.now(timezone.utc), True
        )

    async def clear(self, alert):
        if self.order is not None:
            self.order.append("clear")
        self.cleared.append(alert)

    @staticmethod
    def should_clear_on_condition_change(alert):
        monitor = alert.get("monitor") or {}
        configured = monitor.get("clear_on_condition_change")
        if configured is not None:
            return bool(configured)
        confirmation = alert.get("confirmation")
        return confirmation is None or not bool(confirmation.get("enabled"))


class FlakyNotification(Notification):
    def __init__(self):
        super().__init__()
        self.failures_remaining = 1

    async def send(self, request: NotificationRequest):
        if self.failures_remaining:
            self.failures_remaining -= 1
            return NotificationOutcome(
                datetime.now(timezone.utc),
                False,
                "temporary delivery failure",
            )
        return await super().send(request)


class Confirmation:
    def __init__(self):
        self.notification = None
        self.alerts = None

    def acknowledge(self, alert_id, confirmed_by, now):
        self.acknowledged = (alert_id, confirmed_by, now)

    @staticmethod
    def next_attempt(runtime):
        return runtime.confirmation.attempts + 1

    @staticmethod
    def reminder_due(_runtime, _now):
        return True

    @staticmethod
    def expire_stale(_runtime, _now):
        return False

    @staticmethod
    def record_attempt(runtime):
        runtime.confirmation.attempts += 1

    def prepare_action(self, runtime, **_kwargs):
        if not (runtime.alert.get("confirmation") or {}).get("enabled", False):
            return
        runtime.confirmation.action_ids = {"confirm": "confirm"}
        return True, "confirm"

    async def send_completion(self, alert, completion_alert, now):
        outcome = await self.notification.send(
            NotificationRequest(
                runtime=AlertRuntimeState.for_alert(completion_alert),
                replace_existing=False,
            )
        )
        self.alerts.publish_event(
            self.alerts.runtime(alert),
            const.AlertEventType.COMPLETION_SENT
            if outcome.success
            else const.AlertEventType.COMPLETION_FAILED,
            "Completion notification sent."
            if outcome.success
            else "Completion notification failed.",
            {} if outcome.success else {"error": outcome.error},
        )

    @staticmethod
    def expire_exhausted(_runtime):
        return None

    def pending_actions(self, runtime):
        if not runtime.confirmation.action_ids:
            return ()
        return (SimpleNamespace(action_id="confirm", label="Confirm"),)

    async def track(self, *_args, **_kwargs):
        return None


class FollowUp:
    def __init__(self, order=None):
        self.calls = []
        self.order = order

    async def execute(self, *args):
        if self.order is not None:
            self.order.append("follow_up")
        self.calls.append(args)

    @staticmethod
    def actions_for_confirmation(_alert):
        return []
def build_flow(notification=None, order=None, confirmations=None):
    alerts = RuntimeAlerts()
    state = alerts.values
    history = History(order)
    alerts.history = history
    follow_up = FollowUp(order)
    persistence = SimpleNamespace(calls=[])

    def persist():
        persistence.calls.append(True)
        if order is not None:
            order.append("persist")

    persistence.persist = persist
    persistence.runtime = lambda alert_id: alerts.runtime(alert_id)
    if notification is None:
        notification = Notification(order=order)
    alerts.notification = notification
    if confirmations is None:
        confirmations = Confirmation()
    confirmations.notification = notification
    confirmations.alerts = alerts
    features = {
        "alerts": alerts,
        "confirmations": confirmations,
        "notification": notification,
        "history": history,
        "follow_up_actions": follow_up,
        "runtime_storage": persistence,
    }
    hass = SimpleNamespace(
        bus=SimpleNamespace(
            async_fire=lambda _event_type, data: history.append_event(data)
        )
    )
    flow = module.AlertFlow(hass, state, None, persistence)
    flow.lifecycle = SimpleNamespace(feature=lambda name: features[name])
    return flow, features


@pytest.mark.asyncio
async def test_exhausted_confirmation_clears_notification():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    class ExhaustedConfirmation(Confirmation):
        def expire_exhausted(self, _runtime):
            return confirmation_module.ConfirmationAttemptsExhausted(
                attempts=2,
                max_attempts=2,
            )

    flow, features = build_flow(confirmations=ExhaustedConfirmation())

    await flow.handle_event(
        condition_event(
            make_alert(), SimpleNamespace(active=True, source="confirmation"), now
        )
    )

    assert features["notification"].cleared
    assert any(
        event[2] == const.AlertEventType.CONFIRMATION_ATTEMPTS_EXHAUSTED
        for event in features["history"].events
    )


@pytest.mark.asyncio
async def test_condition_error_and_inactive_clear_notification():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()
    alert = make_alert()
    transition = SimpleNamespace(
        active=None,
        error="bad template",
        source="startup",
    )
    await flow.handle_event(
        condition_event(alert, transition, now, features["alerts"].values["alert_1"])
    )
    assert features["history"].events[0][2] == const.AlertEventType.CONDITION_ERROR

    transition = SimpleNamespace(active=False, source="change")
    await flow.handle_event(
        condition_event(alert, transition, now, features["alerts"].values["alert_1"])
    )
    assert features["notification"].cleared


@pytest.mark.asyncio
async def test_condition_change_clear_can_be_disabled():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()
    alert = make_alert(monitor={"clear_on_condition_change": False})

    await flow.handle_event(
        condition_event(
            alert,
            SimpleNamespace(active=False, source="change"),
            now,
            features["alerts"].values["alert_1"],
        )
    )

    assert not features["notification"].cleared


@pytest.mark.asyncio
async def test_active_condition_sends_and_runs_follow_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()

    await flow.handle_event(
        condition_event(
            make_alert(),
            SimpleNamespace(active=True, source="startup"),
            now,
            features["alerts"].values["alert_1"],
        )
    )

    assert features["notification"].sent[0]["attempt"] is None
    assert features["notification"].sent[0]["notification_actions"] == []
    assert features["follow_up_actions"].calls


@pytest.mark.asyncio
async def test_active_condition_orders_effects():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    order = []
    flow, _features = build_flow(order=order)

    await flow.handle_event(
        condition_event(
            make_alert(),
            SimpleNamespace(active=True, source="startup"),
            now,
            _features["alerts"].values["alert_1"],
        )
    )

    assert order == [
        "notification",
        "notification_outcome",
        "follow_up",
    ]


@pytest.mark.asyncio
async def test_failed_delivery_records_failure_without_follow_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow(Notification(fail=True))

    await flow.handle_event(
        condition_event(
            make_alert(),
            SimpleNamespace(active=True, source="interval"),
            now,
            features["alerts"].values["alert_1"],
        )
    )

    assert features["notification"].fail
    assert features["alerts"].values["alert_1"].confirmation.attempts == 0
    assert not features["follow_up_actions"].calls
    assert features["history"].events[-1][4]["error"] == "delivery failed"


@pytest.mark.asyncio
async def test_retry_after_delivery_failure_sends_and_runs_follow_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow(FlakyNotification())
    transition = SimpleNamespace(active=True, source="interval")

    await flow.handle_event(
        condition_event(
            make_alert(), transition, now, features["alerts"].values["alert_1"]
        )
    )
    assert not features["notification"].sent
    assert not features["follow_up_actions"].calls

    await flow.handle_event(
        condition_event(
            make_alert(), transition, now, features["alerts"].values["alert_1"]
        )
    )
    assert features["notification"].sent[-1]["attempt"] is None
    assert len(features["follow_up_actions"].calls) == 1
    assert [
        event[4].get("success", event[4].get("error") is None)
        for event in features["history"].events
        if event[2]
        in (
            const.AlertEventType.NOTIFICATION_SENT,
            const.AlertEventType.NOTIFICATION_FAILED,
        )
    ] == [False, True]


@pytest.mark.asyncio
async def test_reminder_sends_next_attempt_as_replacement():
    now = datetime(2026, 1, 2, tzinfo=timezone.utc)
    flow, features = build_flow()
    runtime = features["alerts"].values["alert_1"]
    runtime.confirmation.attempts = 1
    runtime.confirmation.action_ids = {"confirm": "confirm"}
    runtime.last_notified = "2026-01-01T00:00:00+00:00"

    await flow.handle_event(
        condition_event(
            make_alert(),
            SimpleNamespace(active=True, source="confirmation"),
            now,
            runtime,
        )
    )

    assert features["notification"].sent[-1]["attempt"] == 2
    assert features["notification"].sent[-1]["replace_existing"] is True
    assert [event[2] for event in features["history"].events] == [
        const.AlertEventType.NOTIFICATION_SENT,
    ]


@pytest.mark.asyncio
async def test_condition_effects_update_runtime_state():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()

    await flow.handle_event(
        condition_event(
            make_alert(),
            SimpleNamespace(active=True, source="interval"),
            now,
            features["alerts"].values["alert_1"],
        )
    )
    assert features["alerts"].values["alert_1"].active is True
