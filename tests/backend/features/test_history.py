"""Tests for pure alert history querying (history.py)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from tests.backend.support.test_support import PACKAGE_NAME, load_const_and_models

load_const_and_models()
history = __import__(f"{PACKAGE_NAME}.features.history", fromlist=["history"])


class AppendListRemoveTests(unittest.TestCase):
    def test_append_trims_to_max_history(self):
        entries: list[dict] = []
        for index in range(501):
            entry = {"details": {"index": index}}
            entries = history.append_entry(entries, entry)

        self.assertEqual(len(entries), 500)
        self.assertEqual(entries[-1]["details"]["index"], 500)

    def test_list_entries_filters_by_alert_newest_first(self):
        entries: list[dict] = []
        for index in range(5):
            entry = {
                "alert": {"id": "first" if index % 2 == 0 else "second"},
                "event": {"details": {"index": index}},
            }
            entries = history.append_entry(entries, entry)

        first_history = history.list_entries(entries, "first", 2)
        self.assertEqual(
            [e["event"]["details"]["index"] for e in first_history], [4, 2]
        )

    def test_list_entries_limit_zero_still_returns_newest(self):
        entries = [
            {"details": {"index": 0}}
        ]
        result = history.list_entries(entries, limit=0)
        self.assertEqual(result[0]["details"]["index"], 0)

    def test_remove_alert_drops_only_matching_events(self):
        entries = [
            {"alert": {"id": "first"}},
            {"alert": {"id": "second"}},
        ]
        remaining = history.remove_alert(entries, "first")
        self.assertTrue(all(event["alert"]["id"] == "second" for event in remaining))

    def test_list_entries_limits_and_retention_preserves_invalid_timestamps(self):
        entries = [
            {"alert": {"id": "alert_1"}, "event": {"timestamp": "not-a-date"}},
            {
                "alert": {"id": "alert_1"},
                "event": {"timestamp": "2026-01-01T00:00:00+00:00"},
            },
        ]

        self.assertEqual(history.list_entries(entries, limit=1), [entries[1]])
        self.assertEqual(
            history.prune_entries(
                entries,
                1,
                now=datetime(2026, 1, 2, tzinfo=timezone.utc),
            ),
            entries,
        )

    def test_prune_entries_by_alert_applies_each_retention_policy(self):
        entries = [
            {
                "alert": {"id": "expired"},
                "event": {"timestamp": "2020-01-01T00:00:00+00:00"},
            },
            {
                "alert": {"id": "kept"},
                "event": {"timestamp": "2020-01-01T00:00:00+00:00"},
            },
            {"alert": {"id": "unconfigured"}, "event": {"timestamp": "not-a-date"}},
        ]

        result = history.prune_entries_by_alert(
            entries, {"expired": 0, "kept": None}
        )

        self.assertEqual(result, [entries[1], entries[2]])


class HistoryFeatureTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_feature_records_queries_and_missing_runtime(self):
        history_entries = []
        async def load_history():
            return None

        storage = SimpleNamespace(
            history=history_entries,
            load_history=load_history,
        )
        feature = history.HistoryFeature(None, storage)
        self.assertEqual(await feature.list_history(limit=1), [])
        self.assertEqual(
            await feature.list_history(limit=1), history_entries[-1:][::-1]
        )

if __name__ == "__main__":
    unittest.main()
