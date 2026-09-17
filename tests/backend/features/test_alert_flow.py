"""Tests for ordered alert effect orchestration."""

from __future__ import annotations

import importlib
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from tests.backend.conftest import make_alert
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
module = importlib.import_module(f"{PACKAGE_NAME}.features.alert_flow")
const = importlib.import_module(f"{PACKAGE_NAME}.const")


class RuntimeAlerts:
    def __init__(self):
        self.values = {"alert_1": {"active": True, "confirmation_action_id": "confirm"}}

    def runtime(self, alert_id):
        return self.values[alert_id]

    def acknowledge(self, *_args):
        return None


class History:
    def __init__(self, order=None):
        self.events = []
        self.order = order

    def record_event(self, *args):
        if self.order is not None:
            self.order.append("history")
        self.events.append(args)
        return True

    def record_notification_outcome(self, *args, **kwargs):
        if self.order is not None:
            self.order.append("notification_outcome")
        self.events.append(("notification", args, kwargs))

    def record(self, *args):
        if self.order is not None:
            self.order.append("history_record")
        self.events.append(("record", args))


class Notification:
    def __init__(self, *, fail=False, order=None):
        self.fail = fail
        self.sent = []
        self.cleared = []
        self.order = order

    @staticmethod
    def next_attempt(runtime):
        return int(runtime.get("attempts", 0)) + 1

    @staticmethod
    def record_delivery_result(runtime, attempt, now, *, success, error=None):
        if success:
            runtime["attempts"] = attempt
        runtime["last_error"] = error

    async def send(self, payload):
        if self.fail:
            raise RuntimeError("delivery failed")
        if self.order is not None:
            self.order.append("notification")
        self.sent.append(payload)

    async def clear(self, alert, now):
        if self.order is not None:
            self.order.append("clear")
        self.cleared.append((alert, now))


class FlakyNotification(Notification):
    def __init__(self):
        super().__init__()
        self.failures_remaining = 1

    async def send(self, payload):
        if self.failures_remaining:
            self.failures_remaining -= 1
            raise RuntimeError("temporary delivery failure")
        await super().send(payload)


class Confirmation:
    async def prepare_action(self, _alert, _runtime):
        return True, "confirm"

    async def track(self, *_args, **_kwargs):
        return None


class FollowUp:
    def __init__(self, order=None):
        self.calls = []
        self.order = order

    async def run(self, *args):
        if self.order is not None:
            self.order.append("follow_up")
        self.calls.append(args)


def build_flow(notification=None, order=None):
    state = {"runtime": {}, "history": []}
    alerts = RuntimeAlerts()
    history = History(order)
    follow_up = FollowUp(order)
    persistence = SimpleNamespace(calls=[])

    def persist():
        persistence.calls.append(True)
        if order is not None:
            order.append("persist")

    persistence.persist = persist
    if notification is None:
        notification = Notification(order=order)
    features = {
        "alerts": alerts,
        "confirmation": Confirmation(),
        "notification": notification,
        "history": history,
        "follow_up_actions": follow_up,
        "runtime_storage": persistence,
    }
    flow = module.AlertFlow(None, state, None, persistence)
    flow.lifecycle = SimpleNamespace(feature=lambda name: features[name])
    return flow, features


@pytest.mark.asyncio
async def test_condition_error_and_inactive_clear_are_recorded():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()
    alert = make_alert()
    transition = SimpleNamespace(
        kind=const.TransitionKind.CONDITION_ERROR,
        error="bad template",
        source="startup",
    )
    await flow.handle_condition(alert, transition, now)
    assert features["history"].events[0][2] == const.HistoryEventType.CONDITION_ERROR

    transition = SimpleNamespace(
        kind=const.TransitionKind.BECAME_INACTIVE,
        source="change",
        had_pending_confirmation=True,
    )
    await flow.handle_condition(alert, transition, now)
    assert features["notification"].cleared


@pytest.mark.asyncio
async def test_active_condition_sends_and_runs_follow_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()

    await flow.handle_condition(
        make_alert(),
        SimpleNamespace(
            kind=const.TransitionKind.BECAME_ACTIVE,
            source="startup",
        ),
        now,
    )

    assert features["notification"].sent[0]["attempt"] == 1
    assert features["notification"].sent[0]["confirmation_action_id"] == "confirm"
    assert features["follow_up_actions"].calls


@pytest.mark.asyncio
async def test_active_condition_orders_effects_before_persisting():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    order = []
    flow, _features = build_flow(order=order)

    await flow.handle_condition(
        make_alert(),
        SimpleNamespace(kind=const.TransitionKind.BECAME_ACTIVE, source="startup"),
        now,
    )

    assert order == [
        "history",
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
        SimpleNamespace(kind=const.TransitionKind.SHOULD_SEND, source="interval"),
        now,
    )

    assert features["notification"].fail
    assert features["alerts"].values["alert_1"].get("attempts", 0) == 0
    assert not features["follow_up_actions"].calls
    assert features["history"].events[-1][2]["success"] is False


@pytest.mark.asyncio
async def test_retry_after_delivery_failure_sends_and_runs_follow_up():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow(FlakyNotification())
    transition = SimpleNamespace(
        kind=const.TransitionKind.SHOULD_SEND,
        source="interval",
    )

    await flow.handle_condition(make_alert(), transition, now)
    assert not features["notification"].sent
    assert not features["follow_up_actions"].calls

    await flow.handle_condition(make_alert(), transition, now)
    assert features["notification"].sent[-1]["attempt"] == 1
    assert len(features["follow_up_actions"].calls) == 1
    assert [
        event[2]["success"]
        for event in features["history"].events
        if event[0] == "notification"
    ] == [False, True]


@pytest.mark.asyncio
async def test_reminder_sends_next_attempt_as_replacement():
    now = datetime(2026, 1, 2, tzinfo=timezone.utc)
    flow, features = build_flow()
    runtime = features["alerts"].values["alert_1"]
    runtime["attempts"] = 1
    runtime["last_notified"] = "2026-01-01T00:00:00+00:00"

    await flow.handle_condition(
        make_alert(),
        SimpleNamespace(
            kind=const.TransitionKind.SHOULD_SEND,
            source="confirmation",
        ),
        now,
    )

    assert features["notification"].sent[-1]["attempt"] == 2
    assert features["notification"].sent[-1]["replace_existing"] is True


@pytest.mark.asyncio
async def test_condition_and_confirmation_effects_persist_runtime_state():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    flow, features = build_flow()

    await flow.handle_condition(
        make_alert(),
        SimpleNamespace(kind=const.TransitionKind.SHOULD_SEND, source="interval"),
        now,
    )
    assert len(features["runtime_storage"].calls) == 1

    result = module.confirmation.ConfirmationResult(
        make_alert(), "Alice", now, False, True
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
    result = module.confirmation.ConfirmationResult(
        alert, "Alice", now, False, True
    )
    await flow.handle_confirmation(result)
    assert features["notification"].cleared
    assert len(features["notification"].sent) == 1
    assert features["follow_up_actions"].calls

    features["notification"].fail = True
    await flow.handle_confirmation(result)
    assert any(
        event[0] == "record"
        and event[1][1] == const.HistoryEventType.COMPLETION_FAILED
        for event in features["history"].events
    )