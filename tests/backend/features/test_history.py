"""Tests for pure alert history formatting/querying (history.py)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from tests.backend.support.test_support import PACKAGE_NAME, load_const_and_models

load_const_and_models()
history = __import__(f"{PACKAGE_NAME}.features.history", fromlist=["history"])


def test_history_entry_contract_snapshot(snapshot):
    entry = history.format_entry(
        {"id": "alert_1", "name": "Alert"},
        "notification_sent",
        "Notification sent.",
        {"attempt": 2},
        now=datetime(2026, 1, 1, tzinfo=timezone.utc),
        flow_id="flow_alert_1_test",
    )
    entry["id"] = "<history_id>"

    assert entry == snapshot


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

    def test_list_entries_limits_and_retention_preserves_invalid_timestamps(self):
        entries = [
            {"alert_id": "alert_1", "timestamp": "not-a-date"},
            {"alert_id": "alert_1", "timestamp": "2026-01-01T00:00:00+00:00"},
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
                "alert_id": "expired",
                "timestamp": "2020-01-01T00:00:00+00:00",
            },
            {
                "alert_id": "kept",
                "timestamp": "2020-01-01T00:00:00+00:00",
            },
            {"alert_id": "unconfigured", "timestamp": "not-a-date"},
        ]

        result = history.prune_entries_by_alert(
            entries, {"expired": 0, "kept": None}
        )

        self.assertEqual(result, [entries[1], entries[2]])


class HistoryFeatureTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_feature_records_queries_and_missing_runtime(self):
        state = {"runtime": {}, "history": []}
        feature = history.HistoryFeature(None, state, None, None)
        alert = {"id": "alert_1", "name": "Alert"}

        self.assertFalse(
            feature.record_notification_outcome(
                alert,
                success=True,
                attempt=1,
                now=datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
        )
        state["runtime"]["alert_1"] = {"flow_id": "flow_1"}
        self.assertTrue(
            feature.record_event(
                state["runtime"]["alert_1"],
                alert,
                "test",
                "Test",
                {"value": 1},
                datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
        )
        self.assertEqual(
            await feature.list_history(limit=1), state["history"][-1:][::-1]
        )


def test_module_history_recorders_update_state_and_respect_disabled_recording():
    state = {"runtime": {"alert_1": {"flow_id": "flow_1"}}, "history": []}
    alert = {"id": "alert_1", "name": "Alert"}
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    assert history.record_notification_outcome(
        state, alert, success=False, attempt=2, error="failed", now=now
    )
    assert state["history"][0]["details"] == {"attempt": 2, "error": "failed"}
    assert history.record_event(
        state,
        state["runtime"]["alert_1"],
        alert,
        "test",
        "Test",
        {},
        now,
    )
    assert not history.record_notification_outcome(
        state,
        alert,
        success=True,
        attempt=3,
        now=now,
        record_history=False,
    )


if __name__ == "__main__":
    unittest.main()
