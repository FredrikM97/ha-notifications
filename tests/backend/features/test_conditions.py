"""Tests for condition evaluation and transition boundaries."""

from __future__ import annotations

import importlib
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()

ConditionFeature = importlib.import_module(
    f"{PACKAGE_NAME}.features.conditions"
).ConditionFeature
ConditionWatchers = importlib.import_module(
    f"{PACKAGE_NAME}.features.conditions"
).ConditionWatchers
ConditionTransition = importlib.import_module(
    f"{PACKAGE_NAME}.domain.workflow"
).ConditionTransition
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
                    "for": 5,
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


def test_compile_condition_skips_empty_template_conditions():
    assert (
        compile_condition({"conditions": [{"type": "template", "template": ""}]})
        == "{{ true }}"
    )


def test_condition_transition_contract_snapshot(snapshot):
    evaluation = ConditionTransition(
        True,
        None,
        "confirmation",
        {"front_door": True},
    )

    assert {
        "active": evaluation.active,
        "error": evaluation.error,
        "source": evaluation.source,
        "facts": evaluation.facts,
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
            "confirmation": {"action_ids": {}, "attempts": 0},
        }
        self.transitions = []

        async def on_transition(event):
            self.transitions.append(event)

        def expire_stale(runtime, now):
            return False

        async def run(_alert_id, operation):
            await operation()

        runtime_storage = SimpleNamespace(runtime=lambda _alert_id: self.runtime)
        self.feature = ConditionFeature(
            None, {"runtime": {"alert_1": self.runtime}}, None, runtime_storage
        )
        self.feature._alerts = {"alert_1": self.alert}
        self.feature.lifecycle = SimpleNamespace(
            feature=lambda name: (
                SimpleNamespace(runtime=lambda _alert_id: self.runtime)
                if name == "alerts"
                else SimpleNamespace(
                    reminder_due=lambda *_args: False,
                    expire_stale=expire_stale,
                )
                if name == "confirmations"
                else SimpleNamespace(handle_condition=on_transition)
                if name == "alert_flow"
                else SimpleNamespace(run=run)
            )
        )

    async def test_inactive_evaluation_does_not_allocate_confirmation(self):
        await self.feature.condition_result(
            "alert_1",
            False,
            None,
            source="change",
            now=self.now,
        )

        self.assertEqual(self.transitions[0].source, "change")
        self.assertEqual(
            self.transitions[0].__class__.__name__, "ConditionInactiveEvent"
        )
        self.assertEqual(self.runtime["confirmation"]["action_ids"], {})

    async def test_condition_error_does_not_allocate_confirmation(self):
        await self.feature.condition_result(
            "alert_1",
            None,
            "template failed",
            source="change",
            now=self.now,
        )

        self.assertEqual(self.transitions[0].source, "change")
        self.assertEqual(self.transitions[0].error, "template failed")
        self.assertEqual(self.runtime["confirmation"]["action_ids"], {})


class ConditionFeatureTests(unittest.TestCase):
    def test_conditions_depend_on_alert_coordinator(self):
        conditions = importlib.import_module(f"{PACKAGE_NAME}.features.conditions")
        self.assertIn(
            "alert_coordinator", conditions.ConditionFeature.dependencies
        )

    def test_watchers_register_change_and_both_interval_sources(self):
        calls = []
        removed = []
        watchers = ConditionWatchers(
            None,
            lambda *args: None,
            lambda *args: None,
            lambda _alert: timedelta(seconds=60),
        )

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
