"""Unit tests for explicit history workflow mutations."""

from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from custom_components.ha_notifications.const import EVENT_ALERT_EVENT
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
history_feature = importlib.import_module(f"{PACKAGE_NAME}.features.history")


def test_append_entry_prunes_configured_retention_period():
    now = datetime(2026, 1, 31, tzinfo=timezone.utc)
    history = [
        {
            "alert": {"id": "alert"},
            "event": {"timestamp": (now - timedelta(days=31)).isoformat()},
        },
        {
            "alert": {"id": "alert"},
            "event": {"timestamp": (now - timedelta(days=2)).isoformat()},
        },
    ]

    result = history_feature.prune_entries(history, 30, now=now)

    assert len(result) == 1
    assert result[0]["event"]["timestamp"] == history[1]["event"]["timestamp"]

def test_prune_entries_by_alert_uses_each_alert_retention():
    now = datetime.now(timezone.utc)
    history = [
        {
            "config": {"id": "short"},
            "event": {"timestamp": (now - timedelta(days=3)).isoformat()},
        },
        {
            "config": {"id": "long"},
            "event": {"timestamp": (now - timedelta(days=3)).isoformat()},
        },
    ]

    result = history_feature.prune_entries_by_alert(history, {"short": 1, "long": 7})

    assert result == [history[1]]

def test_prune_entries_by_alert_preserves_disabled_retention():
    now = datetime.now(timezone.utc)
    history = [
        {
            "config": {"id": "unlimited"},
            "event": {"timestamp": (now - timedelta(days=365)).isoformat()},
        }
    ]

    result = history_feature.prune_entries_by_alert(history, {"unlimited": None})

    assert result == history

def test_remove_alert_removes_only_matching_entries():
    history = [
        {"config": {"id": "alert_1"}},
        {"config": {"id": "alert_2"}},
        {"config": {"id": "alert_1"}},
    ]

    assert history_feature.remove_alert(history, "alert_1") == [
        {"config": {"id": "alert_2"}}
    ]

@pytest.mark.asyncio
async def test_history_listener_persists_published_event(hass, snapshot):
    persisted_events = []
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    async def store_event(event_data):
        persisted_events.append(event_data)

    storage = SimpleNamespace(store_event=store_event)
    feature = history_feature.HistoryFeature(hass, storage)
    await feature.on_setup()
    hass.bus.async_fire(
        EVENT_ALERT_EVENT,
        {
            "id": "event_1",
            "config": {"id": "alert_1", "name": "Alert"},
            "condition": {"flow_id": "flow_1"},
            "event": {
                "event_id": "event_1",
                "timestamp": now.isoformat(),
                "type": "notification_failed",
                "message": "Notification failed.",
                "details": {"attempt": 2, "error": "boom"},
            },
        },
    )
    await hass.async_block_till_done()
    await feature.on_unload()

    entry = persisted_events[0]
    assert entry == snapshot
    assert persisted_events == [entry]
