"""Unit tests for controller/alerts.py - the pure alert-trigger watcher.

No Home Assistant fakes needed: alerts.py has zero `homeassistant` imports,
so it's imported directly through the normal import machinery once the
lightweight fake `custom_components`/`custom_components.notification_center`
package shims are in place (see test_support.ensure_package).
"""

from __future__ import annotations

import importlib
import unittest
from datetime import datetime, timedelta, timezone

from conftest import make_alert
from test_support import PACKAGE_NAME, ensure_package

ensure_package()
alerts = importlib.import_module(f"{PACKAGE_NAME}.features.triggering")
const = importlib.import_module(f"{PACKAGE_NAME}.const")


def _alert(**overrides):
    return make_alert(**overrides)


class OnConditionResultTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    def test_condition_error_is_reported_without_mutating_state(self):
        states = {}
        alert = _alert()
        transition = alerts.on_condition_result(
            states, alert, None, "boom", self.now, source="change"
        )
        self.assertEqual(transition.kind, const.TransitionKind.CONDITION_ERROR)
        self.assertEqual(transition.error, "boom")
        self.assertNotIn("alert_1", states)

    def test_becomes_active_starts_episode(self):
        states = {}
        alert = _alert()
        transition = alerts.on_condition_result(
            states, alert, True, None, self.now, source="change"
        )
        self.assertEqual(transition.kind, const.TransitionKind.BECAME_ACTIVE)
        self.assertEqual(transition.attempt, 1)
        state = states["alert_1"]
        self.assertTrue(state["active"])
        self.assertFalse(state["acknowledged"])
        self.assertIsNotNone(state["flow_id"])

    def test_confirmation_action_created_once(self):
        states = {}
        alert = _alert(
            notification={
                "action": "notify.mobile_app_phone",
                "target": {},
                "title": "t",
                "message": "m",
                "confirmation": {"enabled": True},
            }
        )
        first = alerts.on_condition_result(
            states, alert, True, None, self.now, source="change"
        )
        self.assertTrue(first.new_confirmation_action)
        self.assertIsNotNone(first.confirmation_action_id)

        # Re-evaluating while still active+unacknowledged with no repeat
        # configured should be a no-op, not create a second action id.
        second = alerts.on_condition_result(
            states, alert, True, None, self.now, source="change"
        )
        self.assertEqual(second.kind, const.TransitionKind.NO_CHANGE)

    def test_inactive_after_active_clears_state(self):
        states = {}
        alert = _alert()
        alerts.on_condition_result(states, alert, True, None, self.now, source="change")
        transition = alerts.on_condition_result(
            states, alert, False, None, self.now, source="change"
        )
        self.assertEqual(transition.kind, const.TransitionKind.BECAME_INACTIVE)
        self.assertFalse(states["alert_1"]["active"])

    def test_inactive_when_never_active_is_no_change(self):
        states = {}
        alert = _alert()
        transition = alerts.on_condition_result(
            states, alert, False, None, self.now, source="change"
        )
        self.assertEqual(transition.kind, const.TransitionKind.NO_CHANGE)

    def test_acknowledged_alert_stays_quiet(self):
        states = {}
        alert = _alert()
        alerts.on_condition_result(states, alert, True, None, self.now, source="change")
        states["alert_1"]["acknowledged"] = True
        transition = alerts.on_condition_result(
            states, alert, True, None, self.now, source="change"
        )
        self.assertEqual(transition.kind, const.TransitionKind.NO_CHANGE)

    def test_repeat_due_triggers_resend_with_replace_existing(self):
        states = {}
        alert = _alert(
            notification={
                "action": "notify.send_message",
                "target": {},
                "title": "t",
                "message": "m",
                "confirmation": {"enabled": False},
                "repeat": {"enabled": True, "interval": 600, "max_attempts": 5},
            }
        )
        alerts.on_condition_result(states, alert, True, None, self.now, source="change")
        # Simulate a completed send so has_sent is true and not acknowledged.
        alerts.record_send_result(states, alert, 1, self.now, success=True)

        later = self.now + timedelta(minutes=11)
        transition = alerts.on_condition_result(
            states, alert, True, None, later, source="interval"
        )
        self.assertEqual(transition.kind, const.TransitionKind.SHOULD_SEND)
        self.assertTrue(transition.replace_existing)
        self.assertEqual(transition.attempt, 2)

    def test_repeat_not_yet_due_is_no_change(self):
        states = {}
        alert = _alert(
            notification={
                "action": "notify.send_message",
                "target": {},
                "title": "t",
                "message": "m",
                "confirmation": {"enabled": False},
                "repeat": {"enabled": True, "interval": 600, "max_attempts": 5},
            }
        )
        alerts.on_condition_result(states, alert, True, None, self.now, source="change")
        alerts.record_send_result(states, alert, 1, self.now, success=True)

        soon = self.now + timedelta(minutes=1)
        transition = alerts.on_condition_result(
            states, alert, True, None, soon, source="interval"
        )
        self.assertEqual(transition.kind, const.TransitionKind.NO_CHANGE)

    def test_startup_source_sends_when_not_yet_sent_and_monitor_startup_true(self):
        states = {"alert_1": alerts.new_alert_state()}
        states["alert_1"]["active"] = True
        alert = _alert(monitor={"on_change": True, "startup": True})
        transition = alerts.on_condition_result(
            states, alert, True, None, self.now, source="startup"
        )
        self.assertEqual(transition.kind, const.TransitionKind.SHOULD_SEND)

    def test_startup_source_skips_when_monitor_startup_false(self):
        states = {"alert_1": alerts.new_alert_state()}
        states["alert_1"]["active"] = True
        alert = _alert(monitor={"on_change": True, "startup": False})
        transition = alerts.on_condition_result(
            states, alert, True, None, self.now, source="startup"
        )
        self.assertEqual(transition.kind, const.TransitionKind.NO_CHANGE)


class RecordSendResultTests(unittest.TestCase):
    def test_success_updates_attempts_and_clears_error(self):
        states = {}
        alert = _alert()
        alerts.ensure_runtime_state(states, alert)
        now = datetime(2024, 1, 1, tzinfo=timezone.utc)
        alerts.record_send_result(states, alert, 3, now, success=True)
        state = states["alert_1"]
        self.assertEqual(state["attempts"], 3)
        self.assertEqual(state["last_notified"], now.isoformat())
        self.assertIsNone(state["last_error"])

    def test_failure_records_error_without_bumping_attempts(self):
        states = {}
        alert = _alert()
        alerts.ensure_runtime_state(states, alert)
        now = datetime(2024, 1, 1, tzinfo=timezone.utc)
        alerts.record_send_result(states, alert, 1, now, success=False, error="boom")
        state = states["alert_1"]
        self.assertEqual(state["attempts"], 0)
        self.assertEqual(state["last_error"], "boom")


class MarkConfirmedTests(unittest.TestCase):
    def test_marks_acknowledged_and_clears_pending_action(self):
        states = {}
        alert = _alert()
        alerts.ensure_runtime_state(states, alert)
        states["alert_1"]["confirmation_action_id"] = "abc"
        now = datetime(2024, 1, 1, tzinfo=timezone.utc)
        alerts.mark_confirmed(states, alert, "Alice", now)
        state = states["alert_1"]
        self.assertTrue(state["acknowledged"])
        self.assertIsNone(state["confirmation_action_id"])
        self.assertEqual(state["confirmed_by"], "Alice")


if __name__ == "__main__":
    unittest.main()
