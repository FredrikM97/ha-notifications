"""Unit tests for explicit history workflow mutations."""

from __future__ import annotations

import importlib
import unittest
from datetime import datetime, timezone

from conftest import make_alert
from test_support import PACKAGE_NAME, ensure_package

ensure_package()
history_feature = importlib.import_module(f"{PACKAGE_NAME}.features.history")
const_module = importlib.import_module(f"{PACKAGE_NAME}.const")

HistoryEventType = const_module.HistoryEventType


def _state_root(alert_id="alert_1"):
    return {"alerts": {alert_id: {"flow_id": "flow_1"}}, "history": []}


class HistoryFeatureTests(unittest.IsolatedAsyncioTestCase):
    def test_notification_outcome_records_flow_and_persistence(self):
        alert = make_alert()
        state_root = _state_root(alert["id"])
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)

        command = history_feature.record_notification_outcome(
            state_root,
            alert,
            success=False,
            attempt=2,
            now=now,
            error="boom",
        )

        self.assertTrue(command)
        entry = state_root["history"][0]
        self.assertEqual(entry["type"], HistoryEventType.NOTIFICATION_FAILED)
        self.assertEqual(entry["flow_id"], "flow_1")
        self.assertEqual(entry["details"], {"attempt": 2, "error": "boom"})
        self.assertIs(state_root["alerts"][alert["id"]]["last_event"], entry)

    def test_notification_outcome_respects_record_history_flag(self):
        alert = make_alert()
        state_root = _state_root(alert["id"])

        command = history_feature.record_notification_outcome(
            state_root,
            alert,
            success=True,
            attempt=1,
            now=datetime(2026, 1, 1, tzinfo=timezone.utc),
            record_history=False,
        )

        self.assertFalse(command)
        self.assertEqual(state_root["history"], [])


if __name__ == "__main__":
    unittest.main()
