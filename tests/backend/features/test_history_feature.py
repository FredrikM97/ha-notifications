"""Unit tests for explicit history workflow mutations."""

from __future__ import annotations

import importlib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from tests.backend.conftest import make_alert
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
history_feature = importlib.import_module(f"{PACKAGE_NAME}.features.history")
core = importlib.import_module(f"{PACKAGE_NAME}.controller.core")


def _state_root(alert_id="alert_1"):
    return {"runtime": {alert_id: {"flow_id": "flow_1"}}, "history": []}


class HistoryFeatureTests(unittest.IsolatedAsyncioTestCase):
    def test_append_entry_prunes_configured_retention_period(self):
        now = datetime(2026, 1, 31, tzinfo=timezone.utc)
        history = [
            {"timestamp": (now - timedelta(days=31)).isoformat()},
            {"timestamp": (now - timedelta(days=2)).isoformat()},
        ]

        result = history_feature.prune_entries(history, 30, now=now)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["timestamp"], history[1]["timestamp"])

    def test_prune_entries_by_alert_uses_each_alert_retention(self):
        now = datetime.now(timezone.utc)
        history = [
            {
                "alert_id": "short",
                "timestamp": (now - timedelta(days=3)).isoformat(),
            },
            {
                "alert_id": "long",
                "timestamp": (now - timedelta(days=3)).isoformat(),
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
                "alert_id": "unlimited",
                "timestamp": (now - timedelta(days=365)).isoformat(),
            }
        ]

        result = history_feature.prune_entries_by_alert(history, {"unlimited": None})

        self.assertEqual(result, history)

    def test_remove_alert_removes_only_matching_entries(self):
        history = [
            {"alert_id": "alert_1"},
            {"alert_id": "alert_2"},
            {"alert_id": "alert_1"},
        ]

        self.assertEqual(
            history_feature.remove_alert(history, "alert_1"),
            [{"alert_id": "alert_2"}],
        )

    def test_controller_persists_published_event(self):
        alert = make_alert()
        state_root = _state_root(alert["id"])
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        persisted_events = []

        def store_event(event_data):
            state_root["history"].append(event_data)
            persisted_events.append(event_data)

        persistence = SimpleNamespace(store_event=store_event)
        controller = object.__new__(core.HaNotificationsController)
        controller._state = state_root
        controller._storage = persistence
        controller._handle_alert_event(SimpleNamespace(data={
            "id": "event_1",
            "timestamp": now.isoformat(),
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "type": "notification_failed",
            "flow_id": "flow_1",
            "message": "Notification failed.",
            "details": {"attempt": 2, "error": "boom"},
        }))
        entry = state_root["history"][0]
        self.assertEqual(entry["type"], "notification_failed")
        self.assertEqual(entry["flow_id"], "flow_1")
        self.assertEqual(entry["details"], {"attempt": 2, "error": "boom"})
        self.assertNotIn("last_event", state_root["runtime"][alert["id"]])
        self.assertEqual(persisted_events, [entry])


if __name__ == "__main__":
    unittest.main()
