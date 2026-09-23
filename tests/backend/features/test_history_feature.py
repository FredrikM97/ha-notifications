"""Unit tests for explicit history workflow mutations."""

from __future__ import annotations

import asyncio
import importlib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
history_feature = importlib.import_module(f"{PACKAGE_NAME}.features.history")


class HistoryFeatureTests(unittest.IsolatedAsyncioTestCase):
    def test_append_entry_prunes_configured_retention_period(self):
        now = datetime(2026, 1, 31, tzinfo=timezone.utc)
        history = [
            {
                "alert": {"id": "alert"},
                "event": {
                    "timestamp": (now - timedelta(days=31)).isoformat()
                },
            },
            {
                "alert": {"id": "alert"},
                "event": {
                    "timestamp": (now - timedelta(days=2)).isoformat()
                },
            },
        ]

        result = history_feature.prune_entries(history, 30, now=now)

        self.assertEqual(len(result), 1)
        self.assertEqual(
            result[0]["event"]["timestamp"], history[1]["event"]["timestamp"]
        )

    def test_prune_entries_by_alert_uses_each_alert_retention(self):
        now = datetime.now(timezone.utc)
        history = [
            {
                "alert": {"id": "short"},
                "event": {"timestamp": (now - timedelta(days=3)).isoformat()},
            },
            {
                "alert": {"id": "long"},
                "event": {"timestamp": (now - timedelta(days=3)).isoformat()},
            },
        ]

        result = history_feature.prune_entries_by_alert(
            history, {"short": 1, "long": 7}
        )

        self.assertEqual(result, [history[1]])

    def test_prune_entries_by_alert_preserves_disabled_retention(self):
        now = datetime.now(timezone.utc)
        history = [
            {
                "alert": {"id": "unlimited"},
                "event": {"timestamp": (now - timedelta(days=365)).isoformat()},
            }
        ]

        result = history_feature.prune_entries_by_alert(history, {"unlimited": None})

        self.assertEqual(result, history)

    def test_remove_alert_removes_only_matching_entries(self):
        history = [
            {"alert": {"id": "alert_1"}},
            {"alert": {"id": "alert_2"}},
            {"alert": {"id": "alert_1"}},
        ]

        self.assertEqual(
            history_feature.remove_alert(history, "alert_1"),
            [{"alert": {"id": "alert_2"}}],
        )

    async def test_history_listener_persists_published_event(self):
        history = []
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        persisted_events = []

        async def store_event(event_data):
            history.append(event_data)
            persisted_events.append(event_data)

        hass = SimpleNamespace(
            async_create_task=lambda coroutine: asyncio.create_task(coroutine),
            bus=SimpleNamespace(async_listen=lambda *_args: lambda: None),
        )
        storage = SimpleNamespace(store_event=store_event)
        feature = history_feature.HistoryFeature(hass, storage)
        feature._handle_alert_event(
            SimpleNamespace(
                data={
                    "id": "event_1",
                    "alert": {"id": "alert_1", "name": "Alert"},
                    "flow_id": "flow_1",
                    "event": {
                        "event_id": "event_1",
                        "timestamp": now.isoformat(),
                        "type": "notification_failed",
                        "message": "Notification failed.",
                        "details": {"attempt": 2, "error": "boom"},
                    },
                }
            )
        )
        await asyncio.sleep(0)
        entry = history[0]
        self.assertEqual(entry["event"]["type"], "notification_failed")
        self.assertEqual(entry["flow_id"], "flow_1")
        self.assertEqual(
            entry["event"]["details"], {"attempt": 2, "error": "boom"}
        )
        self.assertEqual(persisted_events, [entry])


if __name__ == "__main__":
    unittest.main()
