"""Tests for condition evaluation and transition boundaries."""

from __future__ import annotations

import importlib
import unittest
from datetime import datetime, timezone

from test_support import PACKAGE_NAME, ensure_package

ensure_package()

TransitionKind = importlib.import_module(
    f"{PACKAGE_NAME}.const"
).TransitionKind
ConditionFeature = importlib.import_module(
    f"{PACKAGE_NAME}.features.conditions"
).ConditionFeature

class ConditionEvaluationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.now = datetime(2024, 1, 1, tzinfo=timezone.utc)
        self.alert = {
            "id": "alert_1",
            "notification": {"message": "Test"},
        }
        self.runtime = {
            "active": False,
            "confirmation_action_id": None,
        }
        self.transitions = []

        async def on_transition(alert, transition, now):
            self.transitions.append(transition)

        self.feature = ConditionFeature(None, {}, None, None)
        self.feature._alerts = {"alert_1": self.alert}
        self.feature._runtime_for = lambda _alert_id: self.runtime
        self.feature._on_transition = on_transition

    async def test_inactive_evaluation_does_not_allocate_confirmation(self):
        await self.feature.condition_result(
            "alert_1",
            False,
            None,
            source="change",
            now=self.now,
        )

        self.assertEqual(self.transitions, [])
        self.assertIsNone(self.runtime["confirmation_action_id"])

    async def test_condition_error_does_not_allocate_confirmation(self):
        await self.feature.condition_result(
            "alert_1",
            None,
            "template failed",
            source="change",
            now=self.now,
        )

        self.assertEqual(self.transitions[0].kind, TransitionKind.CONDITION_ERROR)
        self.assertIsNone(self.runtime["confirmation_action_id"])


class ConditionFeatureTests(unittest.TestCase):
    def test_conditions_depend_on_alert_flow(self):
        conditions = importlib.import_module(f"{PACKAGE_NAME}.features.conditions")
        self.assertIn("alert_flow", conditions.ConditionFeature.dependencies)
