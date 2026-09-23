"""Tests for alert configuration and runtime transitions."""

from __future__ import annotations

import json
from datetime import datetime
from types import MappingProxyType, SimpleNamespace

from custom_components.ha_notifications.const import AlertEventType, FeatureName
from custom_components.ha_notifications.domain.runtime import serialize_runtime
from custom_components.ha_notifications.domain.workflow import (
    ConditionStatus,
    ConditionWorkflowEvent,
    NotificationOutcome,
)
from custom_components.ha_notifications.features.alerts import AlertFeature
from custom_components.ha_notifications.features.configuration import Alert
from tests.backend.conftest import make_alert, make_runtime_state


def test_runtime_trace_serializes_datetime_values_for_transport() -> None:
    runtime = make_runtime_state()
    runtime.record_event(
        ConditionWorkflowEvent(
            runtime=runtime,
            source="test",
            now=datetime(2026, 9, 23, 12, 0, 0),
            status=ConditionStatus.ACTIVE,
            flow_id="flow_alert_1",
        )
    )

    payload = serialize_runtime(runtime)

    json.dumps(payload)
    assert payload["trace"][0]["now"] == "2026-09-23T12:00:00"


async def test_disabled_runtime_reset_contract_snapshot(snapshot):
    state = {"alert_1": make_runtime_state(
        active=True,
        confirmation={
            "attempts": 4,
            "action_ids": {"confirm_1": "confirm"},
        },
        last_notified="2026-09-16T12:00:00+00:00",
    )}
    runtime_storage = SimpleNamespace(
        persist=lambda: None,
    )
    feature = AlertFeature(None, state, None, runtime_storage)
    feature._alerts = {
        "alert_1": Alert(id="alert_1", name="Alert", enabled=True)
    }

    await feature.apply_config(
        {"alerts": [make_alert(enabled=False, name="Alert")]}
    )

    assert serialize_runtime(feature.runtime("alert_1")) == snapshot


async def test_disabling_and_reenabling_resets_runtime_confirmation_attempts() -> None:
    state = {"alert_1": make_runtime_state(
        active=True,
        confirmation={
            "attempts": 4,
            "action_ids": {"confirm_1": "confirm"},
        },
        last_notified="2026-09-16T12:00:00+00:00",
    )}
    runtime_storage = SimpleNamespace(
        persist=lambda: None,
    )
    feature = AlertFeature(None, state, None, runtime_storage)
    feature._alerts = {
        "alert_1": Alert(id="alert_1", name="Alert", enabled=True)
    }

    await feature.apply_config(
        {"alerts": [make_alert(enabled=False, name="Alert")]}
    )

    runtime = feature.runtime("alert_1")
    assert runtime.confirmation.attempts == 0
    assert runtime.confirmation.action_ids == {}
    assert runtime.condition_active is False


async def test_runtime_reset_preserves_evaluation_context() -> None:
    state = {"alert_1": make_runtime_state(
        last_evaluated="2026-09-21T10:00:00+00:00",
    )}
    runtime_storage = SimpleNamespace(persist=lambda: None)
    feature = AlertFeature(None, state, None, runtime_storage)
    feature._alerts = {
        "alert_1": Alert(id="alert_1", name="Alert", enabled=True)
    }

    await feature.apply_config(
        {"alerts": [make_alert(enabled=False, name="Alert")]}
    )

    runtime = feature.runtime("alert_1")
    assert runtime.last_evaluated == "2026-09-21T10:00:00+00:00"
    assert not hasattr(runtime, "last_event")


def test_publish_event_contains_complete_runtime_snapshot() -> None:
    events = []
    hass = SimpleNamespace(
        bus=SimpleNamespace(
            async_fire=lambda _event_type, data: events.append(data)
        )
    )
    state = {
        "alert_1": make_runtime_state(
            alert={"id": "alert_1", "name": "Alert"}, flow_id="flow_1"
        )
    }
    feature = AlertFeature(hass, state, None, None)

    feature.publish_event(
        state["alert_1"],
        AlertEventType.NOTIFICATION_SENT,
        "Notification sent.",
        {"attempt": 1},
    )

    assert events[0]["config"] == {"id": "alert_1", "name": "Alert"}
    assert "trace" not in events[0]
    assert events[0]["event"]["type"] == AlertEventType.NOTIFICATION_SENT.value
    assert events[0]["event"]["details"] == {"attempt": 1}
    assert state["alert_1"].trace == []


def test_runtime_trace_preserves_existing_dataclass_order() -> None:
    runtime = make_runtime_state(alert={"id": "alert_1", "name": "Alert"})
    first = NotificationOutcome(datetime(2026, 1, 1), True)
    second = NotificationOutcome(datetime(2026, 1, 2), False, "failed")
    runtime.record_event(first)
    runtime.record_event(second)

    assert runtime.trace == [first, second]


def test_runtime_trace_does_not_evict_existing_facts() -> None:
    runtime = make_runtime_state(alert={"id": "alert_1", "name": "Alert"})
    facts = [
        NotificationOutcome(datetime(2026, 1, 1), True)
        for _ in range(101)
    ]

    for fact in facts:
        runtime.record_event(fact)

    assert runtime.trace == facts


async def test_save_update_preserves_created_at_and_delete_cleans_owned_state(
    snapshot,
):
    class Storage:
        def __init__(self):
            self.config = {
                "version": 1,
                "alerts": [
                    {
                        "id": "alert_1",
                        "name": "Old",
                        "created_at": "created",
                    }
                ],
            }
            self.saved = []

        async def load_config(self):
            return MappingProxyType(self.config)

        async def save_config(self, config):
            self.saved.append(config)
            self.config = config

    class Notification:
        def __init__(self):
            self.cleared = []

        async def clear(self, alert):
            self.cleared.append(alert)

    storage = Storage()
    notification = Notification()
    state = {"alert_1": make_runtime_state(active=True)}
    history_storage = SimpleNamespace(
        history=[{"alert_id": "alert_1"}, {"alert_id": "other"}],
        persist_history=lambda: None,
    )

    async def remove_alert(alert_id):
        history_storage.history[:] = [
            entry
            for entry in history_storage.history
            if entry["alert_id"] != alert_id
        ]

    history_storage.remove_alert = remove_alert
    feature = AlertFeature(
        None, state, storage, SimpleNamespace(persist=lambda: None)
    )
    feature._alerts = {"alert_1": Alert(id="alert_1", name="Old")}
    feature.lifecycle = SimpleNamespace(
        feature=lambda name: (
            history_storage if name == FeatureName.HISTORY else notification
        )
    )

    saved = await feature.save_alert(make_alert(name="New"))
    saved["updated_at"] = "<timestamp>"
    assert saved == snapshot

    assert await feature.delete_alert("alert_1")
    assert notification.cleared
    assert state == {}
    assert history_storage.history == [{"alert_id": "other"}]
