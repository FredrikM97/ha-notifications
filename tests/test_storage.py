"""Tests for pure YAML/state (de)serialization (storage.py)."""

from __future__ import annotations

import unittest

from test_support import load_storage

storage = load_storage()


class YamlTextTests(unittest.TestCase):
    def test_parse_yaml_accepts_empty_and_mapping_documents(self):
        self.assertEqual(storage.parse_yaml_text(""), {})
        self.assertEqual(storage.parse_yaml_text("alerts: []"), {"alerts": []})

    def test_parse_yaml_rejects_non_mapping_documents(self):
        with self.assertRaisesRegex(ValueError, "must contain a mapping"):
            storage.parse_yaml_text("- alert")

    def test_default_config_yaml_round_trips(self):
        text = storage.default_config_yaml_text()
        self.assertEqual(storage.parse_yaml_text(text), storage.DEFAULT_CONFIG)


class NormalizeAndValidateTests(unittest.TestCase):
    def test_validate_does_not_mutate_input_shape_unexpectedly(self):
        result = storage.normalize_and_validate_yaml(
            "alerts:\n  - name: Test\n    conditions:\n"
            "      - type: template\n        template: '{{ true }}'\n"
        )
        self.assertEqual(result["alerts"][0]["id"], "test")

    def test_invalid_yaml_raises_without_touching_anything(self):
        with self.assertRaises(ValueError):
            storage.normalize_and_validate_yaml("- invalid\n")

    def test_normalize_and_dump_yaml_round_trips(self):
        normalized, text = storage.normalize_and_dump_yaml(
            {
                "version": 1,
                "alerts": [
                    {
                        "id": "demo",
                        "name": "Demo",
                        "conditions": [],
                        "monitor": {"on_change": True, "startup": True},
                        "notification": {
                            "action": "notify.mobile_app_phone",
                            "target": {"entity_id": ["notify.phone"]},
                            "title": "Demo",
                            "message": "Check this",
                        },
                        "notifications": [{"action": "notify.legacy"}],
                    }
                ],
            }
        )
        self.assertEqual(normalized["version"], 1)
        self.assertEqual(text.count("notification:"), 1)
        self.assertNotIn("notifications:", text)

    def test_normalize_and_dump_yaml_repairs_stale_browser_duration_text(self):
        _, text = storage.normalize_and_dump_yaml(
            {
                "version": 1,
                "alerts": [
                    {
                        "id": "demo",
                        "name": "Demo",
                        "conditions": [
                            {
                                "type": "state",
                                "entity_id": "sensor.water",
                                "state": "low",
                                "for": "[object Object]",
                            }
                        ],
                        "monitor": {"interval": "[object Object]"},
                        "notification": {
                            "repeat": {"interval": "[object Object]"},
                            "confirmation": {
                                "enabled": True,
                                "resend_interval": "[object Object]",
                            },
                        },
                    }
                ],
            }
        )
        self.assertNotIn("[object Object]", text)
        self.assertIn("resend_interval:", text)
        self.assertIn("minutes: 30", text)


class RuntimeStateShapeTests(unittest.TestCase):
    def test_repairs_invalid_shapes(self):
        state = storage.ensure_runtime_state_shape({"alerts": [], "history": "invalid"})
        self.assertEqual(state["alerts"], {})
        self.assertEqual(state["history"], [])

    def test_defaults_when_not_a_mapping(self):
        state = storage.ensure_runtime_state_shape(None)
        self.assertEqual(state, {"alerts": {}, "history": []})


if __name__ == "__main__":
    unittest.main()
