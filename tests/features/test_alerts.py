"""Tests for alert configuration and runtime transitions."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from custom_components.ha_notifications.const import STATE_RUNTIME
from custom_components.ha_notifications.features.alerts import AlertFeature
from custom_components.ha_notifications.features.configuration import Alert
from tests.conftest import make_alert, make_runtime_state


async def test_disabled_runtime_reset_contract_snapshot(snapshot):
    state = {
        STATE_RUNTIME: {
            "alert_1": make_runtime_state(
                active=True,
                attempts=4,
                confirmation_action_id="confirm_1",
                last_notified="2026-09-16T12:00:00+00:00",
            )
        }
    }
    feature = AlertFeature(None, state, None, None)
    feature._alerts = {
        "alert_1": Alert(id="alert_1", name="Alert", enabled=True)
    }

    await feature.apply_config(
        {"alerts": [make_alert(enabled=False, name="Alert")]}
    )

    assert feature.runtime("alert_1") == snapshot


async def test_disabling_and_reenabling_resets_runtime_attempts() -> None:
    state = {
        STATE_RUNTIME: {
            "alert_1": make_runtime_state(
                active=True,
                attempts=4,
                confirmation_action_id="confirm_1",
                last_notified="2026-09-16T12:00:00+00:00",
            )
        }
    }
    feature = AlertFeature(None, state, None, None)
    feature._alerts = {
        "alert_1": Alert(id="alert_1", name="Alert", enabled=True)
    }

    await feature.apply_config(
        {"alerts": [make_alert(enabled=False, name="Alert")]}
    )

    runtime = feature.runtime("alert_1")
    assert runtime["attempts"] == 0
    assert runtime["confirmation_action_id"] is None
    assert runtime["active"] is False


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

        async def load(self):
            return self.config

        async def save(self, config):
            self.saved.append(config)
            self.config = config

    class Notification:
        def __init__(self):
            self.cleared = []

        async def clear(self, alert, now):
            self.cleared.append((alert, now))

    storage = Storage()
    notification = Notification()
    state = {
        STATE_RUNTIME: {"alert_1": make_runtime_state(active=True)},
        "history": [{"alert_id": "alert_1"}, {"alert_id": "other"}],
    }
    feature = AlertFeature(
        None, state, storage, SimpleNamespace(persist=lambda: None)
    )
    feature._alerts = {"alert_1": Alert(id="alert_1", name="Old")}
    feature.lifecycle = SimpleNamespace(feature=lambda name: notification)

    saved = await feature.save_alert(make_alert(name="New"))
    saved["updated_at"] = "<timestamp>"
    assert saved == snapshot

    assert await feature.delete_alert("alert_1")
    assert notification.cleared
    assert state[STATE_RUNTIME] == {}
    assert state["history"] == [{"alert_id": "other"}]


def test_acknowledge_updates_confirmation_runtime(snapshot):
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    state = {STATE_RUNTIME: {}}
    feature = AlertFeature(None, state, None, None)

    feature.acknowledge("alert_1", "Alice", now)

    assert state[STATE_RUNTIME]["alert_1"] == snapshot

