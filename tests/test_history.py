"""Tests for pure alert history formatting/querying (history.py)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from test_support import (
    INTEGRATION_ROOT,
    PACKAGE_NAME,
    load_const_and_models,
    load_module,
)

load_const_and_models()
history = load_module(
    f"{PACKAGE_NAME}.support.history", INTEGRATION_ROOT / "support" / "history.py"
)


class FormatEntryTests(unittest.TestCase):
    def test_builds_expected_fields(self):
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        entry = history.format_entry(
            {"id": "first", "name": "Alert"},
            "test",
            "Test notification sent.",
            {"index": 1},
            now=now,
        )
        self.assertEqual(entry["alert_id"], "first")
        self.assertEqual(entry["alert_name"], "Alert")
        self.assertEqual(entry["type"], "test")
        self.assertEqual(entry["message"], "Test notification sent.")
        self.assertEqual(entry["details"], {"index": 1})
        self.assertEqual(entry["timestamp"], now.isoformat())
        self.assertNotIn("flow_id", entry)

    def test_includes_flow_id_when_provided(self):
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        entry = history.format_entry(
            {"id": "flowing", "name": "Flowing"},
            "notification_sent",
            "Notification sent.",
            {"attempt": 1},
            now=now,
            flow_id="flow_flowing_1234",
        )
        self.assertEqual(entry["flow_id"], "flow_flowing_1234")


class AppendListRemoveTests(unittest.TestCase):
    def test_append_trims_to_max_history(self):
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        entries: list[dict] = []
        for index in range(501):
            alert = {"id": "first" if index % 2 == 0 else "second", "name": "Alert"}
            entry = history.format_entry(
                alert, "test", "sent", {"index": index}, now=now
            )
            entries = history.append_entry(entries, entry)

        self.assertEqual(len(entries), 500)
        self.assertEqual(entries[-1]["details"]["index"], 500)

    def test_list_entries_filters_by_alert_newest_first(self):
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        entries: list[dict] = []
        for index in range(5):
            alert = {"id": "first" if index % 2 == 0 else "second", "name": "Alert"}
            entry = history.format_entry(
                alert, "test", "sent", {"index": index}, now=now
            )
            entries = history.append_entry(entries, entry)

        first_history = history.list_entries(entries, "first", 2)
        self.assertEqual([e["details"]["index"] for e in first_history], [4, 2])

    def test_list_entries_limit_zero_still_returns_newest(self):
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        entries = [
            history.format_entry(
                {"id": "a", "name": "A"}, "test", "sent", {"index": 0}, now=now
            )
        ]
        result = history.list_entries(entries, limit=0)
        self.assertEqual(result[0]["details"]["index"], 0)

    def test_remove_alert_drops_only_matching_events(self):
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        entries = [
            history.format_entry(
                {"id": "first", "name": "First"}, "test", "sent", {}, now=now
            ),
            history.format_entry(
                {"id": "second", "name": "Second"}, "test", "sent", {}, now=now
            ),
        ]
        remaining = history.remove_alert(entries, "first")
        self.assertTrue(all(event["alert_id"] == "second" for event in remaining))


if __name__ == "__main__":
    unittest.main()
