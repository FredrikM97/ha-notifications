"""Tests for ordered alert effect orchestration."""

from __future__ import annotations

import importlib
from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from custom_components.ha_notifications.domain.workflow import (
    ConditionActiveEvent,
    ConditionErrorEvent,
    ConditionInactiveEvent,
    ConditionTransition,
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


def condition_event(alert, transition, now):
    if transition.error is not None:
        return ConditionErrorEvent(alert, transition.error, transition.source, now)
    if transition.active is False:
        return ConditionInactiveEvent(alert, transition.source, now)
    return ConditionActiveEvent(
        alert, transition.source, transition.facts or {}, now
    )


@pytest.mark.asyncio
async def test_setup_builds_immutable_ordered_workflow_plan():
    flow = module.AlertFlow(None, {}, None, SimpleNamespace())
    flow.lifecycle = SimpleNamespace(
        feature=lambda name: SimpleNamespace(
            alerts={"alert_1": SimpleNamespace(id="alert_1")}
        )
    )

    await flow.on_setup()

    plan = flow.plan("alert_1")
    assert plan.phases == tuple(module.WorkflowPhase)
    with pytest.raises(FrozenInstanceError):
        plan.alert_id = "changed"


class RuntimeAlerts:
    def __init__(self):
        self.notification = None
        self.history = None
        self.values = {
            "alert_1": {
                "active": True,
                "confirmation": {"action_ids": {}, "attempts": 0},
            }
        }

    def runtime(self, alert_id):
        return self.values[alert_id]

    async def deactivate(self, alert, now, _source):
        runtime = self.runtime(alert["id"])
        if not runtime.get("active", False):
            return None
        runtime["active"] = False
        runtime["acknowledged"] = False
        runtime["notification_id"] = None
        runtime["flow_id"] = None
        monitor = alert.get("monitor") or {}
        configured = monitor.get("clear_on_condition_change")
        confirmation = alert.get("confirmation")
        clear_notification = (
            bool(configured)
            if configured is not None
            else confirmation is None or not confirmation.get("enabled", False)
        )
        if clear_notification and self.notification is not None:
            await self.notification.clear(alert, now)
        return True

    def publish_event(self, alert, event_type, message, details, now):
        if self.history is None:
            return
        self.history.append_event(
            {
                "alert_id": alert["id"],
                "type": event_type.value,
                "message": message,
                "details": dict(details),
                "timestamp": now.isoformat(),
            }
        )

    def acknowledge(self, *_args):
        return None

    def next_attempt(self, alert_id):
        return self.values[alert_id]["confirmation"]["attempts"] + 1

    def record_delivery_result(self, alert_id, attempt, now, *, success, error=None):
        runtime = self.values[alert_id]
        if success:
            runtime["confirmation"]["attempts"] = attempt
        runtime["last_error"] = error


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
                "alert": dict(request.alert),
                "attempt": request.attempt,
                "notification_actions": list(request.notification_actions),
                "replace_existing": request.replace_existing,
                "now": request.now,
                "condition_facts": dict(request.condition_facts),
                "trigger_source": request.trigger_source,
            }
        )
        if self.fail:
            return NotificationOutcome(
                request.attempt, request.now, False, "delivery failed"
            )
        return NotificationOutcome(request.attempt, request.now, True)

    async def clear(self, alert, now):
        if self.order is not None:
            self.order.append("clear")
        self.cleared.append((alert, now))

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
                request.attempt,
                request.now,
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
        return runtime["confirmation"]["attempts"] + 1

    @staticmethod
    def reminder_due(_alert, _runtime, _now):
        return True

    @staticmethod
    def expire_stale(_runtime, _now):
        return False

    @staticmethod
    def record_attempt(runtime):
        runtime["confirmation"]["attempts"] += 1

    def prepare_action(self, _alert, runtime, **_kwargs):
        if not (_alert.get("confirmation") or {}).get("enabled", False):
            return
        runtime["confirmation"]["action_ids"] = {"confirm": "confirm"}
        return True, "confirm"

    async def send_completion(self, alert, completion_alert, now):
        outcome = await self.notification.send(
            NotificationRequest(
                alert=completion_alert,
                attempt=1,
                now=now,
                replace_existing=False,
            )
        )
        self.alerts.publish_event(
            alert,
            const.AlertEventType.COMPLETION_SENT
            if outcome.success
            else const.AlertEventType.COMPLETION_FAILED,
            "Completion notification sent."
            if outcome.success
            else "Completion notification failed.",
            {} if outcome.success else {"error": outcome.error},
            now,
        )

    @staticmethod
    def expire_exhausted(_alert, _runtime):
        return None

    def pending_actions(self, _alert, runtime):
        return SimpleNamespace(
            primary_action_id="confirm",
            selections=("confirm",)
            if runtime["confirmation"]["action_ids"]
            else (),
            notification_actions=lambda: [],
        )

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
    state = {"runtime": alerts.values, "history": []}
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
        def expire_exhausted(self, _alert, _runtime):
            return confirmation_module.ConfirmationAttemptsExhausted(
                attempts=2,
                max_attempts=2,
            )

    flow, features = build_flow(confirmations=ExhaustedConfirmation())

    await flow.handle_condition(
        condition_event(
            make_alert(), ConditionTransition(True, source="confirmation"), now
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
    await flow.handle_condition(condition_event(alert, transition, now))
    assert features["history"].events[0][2] == const.AlertEventType.CONDITION_ERROR

    transition = ConditionTransition(False, source="change")
    await flow.handle_condition(condition_event(alert, transition, now))
    assert features["notification"].cleared


@pytest.mark.asyncio
async def test_condition_change_clear_can_be_disabled():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()
    alert = make_alert(monitor={"clear_on_condition_change": False})

    await flow.handle_condition(
        condition_event(alert, ConditionTransition(False, source="change"), now)
    )

    assert not features["notification"].cleared


@pytest.mark.asyncio
async def test_active_condition_sends_and_runs_follow_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()

    await flow.handle_condition(
        condition_event(
            make_alert(), ConditionTransition(True, source="startup"), now
        )
    )

    assert features["notification"].sent[0]["attempt"] is None
    assert features["notification"].sent[0]["notification_actions"] == []
    assert features["follow_up_actions"].calls


@pytest.mark.asyncio
async def test_active_condition_orders_effects_before_persisting():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    order = []
    flow, _features = build_flow(order=order)

    await flow.handle_condition(
        condition_event(
            make_alert(), ConditionTransition(True, source="startup"), now
        )
    )

    assert order == [
        "notification",
        "notification_outcome",
        "follow_up",
        "persist",
    ]


@pytest.mark.asyncio
async def test_failed_delivery_records_failure_without_follow_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow(Notification(fail=True))

    await flow.handle_condition(
        condition_event(
            make_alert(), ConditionTransition(True, source="interval"), now
        )
    )

    assert features["notification"].fail
    assert features["alerts"].values["alert_1"]["confirmation"]["attempts"] == 0
    assert not features["follow_up_actions"].calls
    assert features["history"].events[-1][4]["error"] == "delivery failed"


@pytest.mark.asyncio
async def test_retry_after_delivery_failure_sends_and_runs_follow_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow(FlakyNotification())
    transition = ConditionTransition(True, source="interval")

    await flow.handle_condition(condition_event(make_alert(), transition, now))
    assert not features["notification"].sent
    assert not features["follow_up_actions"].calls

    await flow.handle_condition(condition_event(make_alert(), transition, now))
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
    runtime["confirmation"]["attempts"] = 1
    runtime["confirmation"]["action_ids"] = {"confirm": "confirm"}
    runtime["last_notified"] = "2026-01-01T00:00:00+00:00"

    await flow.handle_condition(
        condition_event(
            make_alert(), ConditionTransition(True, source="confirmation"), now
        )
    )

    assert features["notification"].sent[-1]["attempt"] == 2
    assert features["notification"].sent[-1]["replace_existing"] is True
    assert [event[2] for event in features["history"].events] == [
        const.AlertEventType.NOTIFICATION_SENT,
    ]


@pytest.mark.asyncio
async def test_condition_effects_persist_runtime_state():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()

    await flow.handle_condition(
        condition_event(
            make_alert(), ConditionTransition(True, source="interval"), now
        )
    )
    assert len(features["runtime_storage"].calls) == 1
