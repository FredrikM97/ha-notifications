"""Tests for persisted alert history."""

from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timezone

from test_support import load_notifications

notifications = load_notifications()


class AlertHistoryTests(unittest.TestCase):
    class Storage:
        def __init__(self) -> None:
            self.saved_states: list[dict] = []

        def async_delay_save_state(self, state: dict) -> None:
            self.saved_states.append(state)

    def test_records_filters_bounds_and_removes_history(self) -> None:
        state = {"alerts": {}, "history": []}
        storage = self.Storage()

        def get_runtime_state(alert: dict) -> dict:
            return state["alerts"].setdefault(alert["id"], {})

        history = notifications.AlertHistory(state, storage, get_runtime_state)
        notifications.dt_util.utcnow = lambda: datetime(
            2026, 1, 1, tzinfo=timezone.utc
        )

        async def record_events() -> None:
            for index in range(501):
                await history.record(
                    {"id": "first" if index % 2 == 0 else "second", "name": "Alert"},
                    "test",
                    "Test notification sent.",
                    {"index": index},
                )

        asyncio.run(record_events())

        self.assertEqual(len(state["history"]), 500)
        self.assertEqual(storage.saved_states[-1], state)
        self.assertEqual(state["alerts"]["first"]["last_event"], state["history"][-1])

        first_history = asyncio.run(history.list("first", 2))
        self.assertEqual(
            [event["details"]["index"] for event in first_history],
            [500, 498],
        )
        self.assertEqual(asyncio.run(history.list(limit=0))[0]["details"]["index"], 500)

        history.remove_alert("first")
        self.assertTrue(
            all(event["alert_id"] == "second" for event in state["history"])
        )

    def test_records_active_flow_id(self) -> None:
        state = {"alerts": {"flowing": {"flow_id": "flow_flowing_1234"}}, "history": []}
        storage = self.Storage()

        def get_runtime_state(alert: dict) -> dict:
            return state["alerts"].setdefault(alert["id"], {})

        history = notifications.AlertHistory(state, storage, get_runtime_state)
        notifications.dt_util.utcnow = lambda: datetime(
            2026, 1, 1, tzinfo=timezone.utc
        )

        asyncio.run(
            history.record(
                {"id": "flowing", "name": "Flowing"},
                "notification_sent",
                "Notification sent.",
                {"attempt": 1},
            )
        )

        self.assertEqual(state["history"][0]["flow_id"], "flow_flowing_1234")
        self.assertEqual(
            state["alerts"]["flowing"]["last_event"]["flow_id"],
            "flow_flowing_1234",
        )


if __name__ == "__main__":
    unittest.main()