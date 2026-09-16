"""Tests for condition evaluation and transition boundaries."""

from __future__ import annotations

import importlib
import unittest
from datetime import datetime, timedelta, timezone

from tests.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()

TransitionKind = importlib.import_module(
    f"{PACKAGE_NAME}.const"
).TransitionKind
ConditionFeature = importlib.import_module(
    f"{PACKAGE_NAME}.features.conditions"
).ConditionFeature
ConditionWatchers = importlib.import_module(
    f"{PACKAGE_NAME}.features.conditions"
).ConditionWatchers
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


def test_compile_condition_skips_incomplete_conditions_and_renders_block_template():
    compiled = compile_condition(
        {
            "conditions": [
                {"type": "state", "entity_id": "sensor.one"},
                {"type": "numeric", "entity_id": "sensor.two"},
                {
                    "type": "template",
                    "template": "{% if is_state('sensor.one', 'on') %}true{% endif %}",
                },
            ]
        }
    )

    assert "{% set nc_condition_0 %}" in compiled
    assert "{% endset %}" in compiled


def test_compile_condition_normalizes_scalar_and_invalid_condition_inputs():
    assert (
        compile_condition({"conditions": [{"type": "template", "template": ""}]})
        == "{{ true }}"
    )
    assert compile_condition({"conditions": ["sensor.test"]}) != "{{ true }}"


def test_transition_matrix_covers_activation_acknowledgement_and_reminders():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    alert = {
        "id": "alert_1",
        "confirmation": {
            "enabled": True,
            "reminders": {"enabled": True, "interval": 60, "max_attempts": 3},
        },
        "monitor": {"startup": True},
    }

    inactive = {}
    became_active = ConditionFeature._transition_for(
        inactive, alert, True, None, now, "startup"
    )
    assert became_active.kind is TransitionKind.BECAME_ACTIVE
    assert inactive["flow_id"].startswith("flow_alert_1_")

    acknowledged = {"active": True, "acknowledged": True}
    assert (
        ConditionFeature._transition_for(
            acknowledged, alert, True, None, now, "change"
        ).kind
        is TransitionKind.NO_CHANGE
    )

    pending = {
        "active": True,
        "attempts": 1,
        "confirmation_action_id": "confirm_1",
        "last_notified": now.isoformat(),
    }
    assert (
        ConditionFeature._transition_for(
            pending, alert, True, None, now, "confirmation"
        ).kind
        is TransitionKind.NO_CHANGE
    )
    assert (
        ConditionFeature._transition_for(
            pending,
            alert,
            True,
            None,
            now + timedelta(seconds=60),
            "confirmation",
        ).kind
        is TransitionKind.SHOULD_SEND
    )

    inactive_transition = ConditionFeature._transition_for(
        pending, alert, False, None, now, "change"
    )
    assert inactive_transition.kind is TransitionKind.BECAME_INACTIVE
    assert inactive_transition.had_pending_confirmation
    assert pending["attempts"] == 0


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

    def test_watchers_register_change_and_both_interval_sources(self):
        calls = []
        removed = []
        watchers = ConditionWatchers(None, lambda *args: None, lambda *args: None)

        def track_template(source, callback):
            calls.append(("template", source, callback))
            return lambda: removed.append("template")

        def track_interval(interval, callback):
            calls.append(("interval", interval, callback))
            return lambda: removed.append("interval")

        watchers._track_template = track_template
        watchers._track_interval = track_interval
        watchers.configure(
            {
                "id": "alert_1",
                "enabled": True,
                "notification": {"message": "Message"},
                "conditions": [{"type": "template", "template": "{{ true }}"}],
                "monitor": {"on_change": True, "interval": 30},
                "confirmation": {
                    "enabled": True,
                    "reminders": {"enabled": True, "interval": 60},
                },
            }
        )

        assert [call[0] for call in calls] == ["template", "interval", "interval"]
        watchers.unconfigure("alert_1")
        assert removed == ["template", "interval", "interval"]
