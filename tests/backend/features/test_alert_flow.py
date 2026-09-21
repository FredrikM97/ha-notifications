"""Tests for ordered alert effect orchestration."""

from __future__ import annotations

import importlib
from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from custom_components.ha_notifications.domain.workflow import (
    ConditionTransition,
    NotificationOutcome,
    NotificationRequest,
)
from tests.backend.conftest import make_alert
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
module = importlib.import_module(f"{PACKAGE_NAME}.features.alert_flow")
const = importlib.import_module(f"{PACKAGE_NAME}.const")


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
        self.values = {
            "alert_1": {
                "active": True,
                "confirmation": {"action_ids": {}, "attempts": 0},
            }
        }

    def runtime(self, alert_id):
        return self.values[alert_id]

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
    def acknowledge(self, alert_id, confirmed_by, now):
        self.acknowledged = (alert_id, confirmed_by, now)

    @staticmethod
    def next_attempt(runtime):
        return runtime["confirmation"]["attempts"] + 1

    @staticmethod
    def record_attempt(runtime):
        runtime["confirmation"]["attempts"] += 1

    def prepare_action(self, _alert, runtime, **_kwargs):
        if not (_alert.get("confirmation") or {}).get("enabled", False):
            return
        runtime["confirmation"]["action_ids"] = {"confirm": "confirm"}
        return True, "confirm"

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


def build_flow(notification=None, order=None):
    alerts = RuntimeAlerts()
    state = {"runtime": alerts.values, "history": []}
    history = History(order)
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
    features = {
        "alerts": alerts,
        "response_actions": Confirmation(),
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
async def test_condition_error_and_inactive_are_recorded_without_cleanup():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()
    alert = make_alert()
    transition = SimpleNamespace(
        active=None,
        error="bad template",
        source="startup",
    )
    await flow.handle_condition(alert, transition, now)
    assert features["history"].events[0][2] == const.AlertEventType.CONDITION_ERROR

    transition = ConditionTransition(False, source="change")
    await flow.handle_condition(alert, transition, now)
    assert not features["notification"].cleared


@pytest.mark.asyncio
async def test_active_condition_sends_and_runs_follow_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()

    await flow.handle_condition(
        make_alert(),
        ConditionTransition(True, source="startup"),
        now,
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
        make_alert(),
        ConditionTransition(True, source="startup"),
        now,
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
        make_alert(),
        ConditionTransition(True, source="interval"),
        now,
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

    await flow.handle_condition(make_alert(), transition, now)
    assert not features["notification"].sent
    assert not features["follow_up_actions"].calls

    await flow.handle_condition(make_alert(), transition, now)
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
        make_alert(),
        ConditionTransition(True, source="confirmation"),
        now,
    )

    assert features["notification"].sent[-1]["attempt"] == 2
    assert features["notification"].sent[-1]["replace_existing"] is True
    assert [event[2] for event in features["history"].events] == [
        const.AlertEventType.NOTIFICATION_SENT,
    ]


@pytest.mark.asyncio
async def test_condition_and_confirmation_effects_persist_runtime_state():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()

    await flow.handle_condition(
        make_alert(),
        ConditionTransition(True, source="interval"),
        now,
    )
    assert len(features["runtime_storage"].calls) == 1

    result = module.response_actions.ConfirmationResult(
        make_alert(),
        module.response_actions.ConfirmationContext(
            "Alice",
            module.response_actions.ConfirmationSelection(
                "confirm", "confirm", "Done"
            ),
        ),
        now,
    )
    await flow.handle_confirmation(result)
    assert len(features["runtime_storage"].calls) == 2


@pytest.mark.asyncio
async def test_confirmation_completion_and_completion_failure_are_recorded(monkeypatch):
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()
    alert = make_alert(
        confirmation={
            "enabled": True,
            "notification": {"enabled": True, "message": "Done"},
        }
    )

    class Planner:
        def __init__(self, *_args):
            pass

        async def build(self, _render):
            return SimpleNamespace(
                clear_notification=True,
                completion_alert=make_alert("completion"),
            )

    monkeypatch.setattr(module.notification, "ConfirmationDeliveryPlanner", Planner)
    result = module.response_actions.ConfirmationResult(
        alert,
        module.response_actions.ConfirmationContext(
            "Alice",
            module.response_actions.ConfirmationSelection(
                "confirm", "confirm", "Done"
            ),
        ),
        now,
    )
    await flow.handle_confirmation(result)
    assert features["notification"].cleared
    assert len(features["notification"].sent) == 1
    assert features["follow_up_actions"].calls

    features["notification"].fail = True
    await flow.handle_confirmation(result)
    assert any(
        event[2] == const.AlertEventType.COMPLETION_FAILED
        for event in features["history"].events
    )