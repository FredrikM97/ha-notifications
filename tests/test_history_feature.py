"""Unit tests for features/history.py - the history-recording listener.

History recording is now a plain bus listener: it subscribes to the same
fact events other features emit, and answers to `GET_STATE`/
`GET_RUNTIME_STATE` are simulated with a tiny fake bus (no Home Assistant
needed - `features/history.py` never imports the gateway).
"""

from __future__ import annotations

import importlib
import unittest
from datetime import datetime, timezone

from test_support import PACKAGE_NAME, ensure_package

from conftest import make_alert

ensure_package()
history_feature = importlib.import_module(f"{PACKAGE_NAME}.features.history")
events_module = importlib.import_module(f"{PACKAGE_NAME}.controller.events")
commands_module = importlib.import_module(f"{PACKAGE_NAME}.controller.commands")
const_module = importlib.import_module(f"{PACKAGE_NAME}.const")

Event = events_module.Event
PersistSave = commands_module.PersistSave
HistoryEventType = const_module.HistoryEventType


class FakeBus:
    """Answers only the two queries `features/history.py` needs."""

    def __init__(self, state_root):
        self.state_root = state_root

    async def ask(self, query_name, payload=None):
        payload = payload or {}
        if query_name == events_module.GET_STATE:
            return self.state_root
        if query_name == events_module.GET_RUNTIME_STATE:
            return self.state_root["alerts"].get(payload["alert_id"])
        raise AssertionError(f"unexpected query: {query_name}")


def _state_root(alert_id="alert_1"):
    return {"alerts": {alert_id: {"flow_id": "flow_1"}}, "history": []}


class HistoryFeatureTests(unittest.IsolatedAsyncioTestCase):
    async def test_condition_active_records_one_entry(self):
        alert = make_alert()
        state_root = _state_root(alert["id"])
        bus = FakeBus(state_root)
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)

        commands = await history_feature._handle_condition_active(
            Event(events_module.CONDITION_ACTIVE, {"alert": alert, "source": "change", "now": now}),
            bus,
        )

        self.assertEqual(len(commands), 1)
        self.assertIsInstance(commands[0], PersistSave)
        self.assertEqual(len(state_root["history"]), 1)
        self.assertEqual(state_root["history"][0]["type"], HistoryEventType.CONDITION_ACTIVE)

    async def test_notification_sent_respects_record_history_flag(self):
        alert = make_alert()
        state_root = _state_root(alert["id"])
        bus = FakeBus(state_root)
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)

        commands = await history_feature._handle_notification_sent(
            Event(
                events_module.NOTIFICATION_SENT,
                {"alert": alert, "attempt": 1, "now": now, "record_history": False},
            ),
            bus,
        )

        self.assertEqual(commands, [])
        self.assertEqual(state_root["history"], [])

    async def test_unknown_alert_records_nothing(self):
        alert = make_alert(alert_id="ghost")
        state_root = _state_root("alert_1")
        bus = FakeBus(state_root)
        now = datetime(2026, 1, 1, tzinfo=timezone.utc)

        commands = await history_feature._handle_condition_active(
            Event(events_module.CONDITION_ACTIVE, {"alert": alert, "source": "change", "now": now}),
            bus,
        )

        self.assertEqual(commands, [])


if __name__ == "__main__":
    unittest.main()
