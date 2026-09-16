"""Tests for condition evaluation and transition boundaries."""

from __future__ import annotations

import importlib
import unittest
from datetime import datetime, timezone

from tests.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()

TransitionKind = importlib.import_module(
    f"{PACKAGE_NAME}.const"
).TransitionKind
ConditionFeature = importlib.import_module(
    f"{PACKAGE_NAME}.features.conditions"
).ConditionFeature
compile_condition = importlib.import_module(
    f"{PACKAGE_NAME}.features.conditions"
).compile_condition


def test_compile_condition_contract(snapshot):
    compiled = compile_condition(
        {
            "logic": "any",
            "conditions": [
                {
                    "type": "state",
                    "entity_id": ["binary_sensor.door"],
                    "state": ["on", "open"],
                    "for": "00:00:05",
                },
                {
                    "type": "numeric",
                    "entity_id": "sensor.temperature",
                    "above": 20,
                    "below": 30,
                },
                {
                    "type": "attribute",
                    "entity_id": "light.kitchen",
                    "attribute": "brightness",
                    "value": 255,
                },
                {"type": "template", "template": "{{ is_state('x', 'on') }}"},
            ],
        }
    )

    assert compiled == snapshot


def test_compile_condition_defaults_to_true_for_empty_or_disabled_conditions():
    assert compile_condition({"conditions": []}) == "{{ true }}"
    assert (
        compile_condition(
            {"conditions": [{"type": "state", "enabled": False}]}
        )
        == "{{ true }}"
    )


def test_condition_transition_contract_snapshot(snapshot):
    transition = ConditionFeature._transition_for(
        {
            "active": True,
            "acknowledged": False,
            "attempts": 2,
            "confirmation_action_id": "confirm_1",
        },
        {
            "id": "alert_1",
            "confirmation": {
                "enabled": True,
                "reminders": {"enabled": True, "max_attempts": 5},
            },
        },
        True,
        None,
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        "confirmation",
    )

    assert {
        "kind": transition.kind.value,
        "error": transition.error,
        "source": transition.source,
        "had_pending_confirmation": transition.had_pending_confirmation,
    } == snapshot

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
