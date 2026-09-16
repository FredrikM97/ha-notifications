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


class ConfigurationStorageTests(unittest.TestCase):
    def test_parse_config_accepts_declared_alert_shape(self):
        result = storage.parse_config(
            "alerts:\n  - id: test\n    name: Test\n    conditions:\n"
            "      - type: template\n        template: '{{ true }}'\n"
        )
        self.assertEqual(result.alerts[0].id, "test")

    def test_invalid_yaml_raises_without_touching_anything(self):
        with self.assertRaises(ValueError):
            storage.parse_config("- invalid\n")

    def test_normalize_and_dump_yaml_round_trips(self):
        config = storage.Configuration.model_validate(
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
                    }
                ],
            }
        )
        normalized, text = storage.dump_config(config)
        self.assertEqual(config.version, 1)
        self.assertEqual(text.count("notification:"), 1)
        self.assertNotIn("notifications:", text)

    def test_preserves_feature_payload_for_feature_validation(self):
        config = storage.Configuration.model_validate(
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
                        },
                        "confirmation": {
                            "enabled": True,
                            "reminders": {"interval": "[object Object]"},
                        },
                    }
                ],
            }
        )
        self.assertEqual(
            config.alerts[0].model_extra["monitor"]["interval"],
            "[object Object]",
        )

    def test_drops_runtime_state_from_yaml_output(self):
        config = storage.Configuration.model_validate(
            {
                "alerts": [
                    {
                        "id": "demo",
                        "name": "Demo",
                        "conditions": [],
                        "monitor": {"on_change": True, "startup": True},
                        "notification": {
                            "target": {"entity_id": ["notify.phone"]},
                            "title": "Demo",
                            "message": "Check this",
                        },
                        "runtime": {
                            "active": True,
                            "attempts": 20,
                            "last_event": {"type": "notification_sent"},
                        },
                    }
                ]
            }
        )

        _, text = storage.dump_config(config)

        self.assertNotIn("runtime:", text)
        self.assertNotIn("last_event:", text)


class RuntimeStateShapeTests(unittest.TestCase):
    def test_repairs_invalid_shapes(self):
        state = storage.ensure_runtime_state_shape({"runtime": [], "history": "invalid"})
        self.assertEqual(state["runtime"], {})
        self.assertEqual(state["history"], [])

    def test_defaults_when_not_a_mapping(self):
        state = storage.ensure_runtime_state_shape(None)
        self.assertEqual(state, {"runtime": {}, "history": []})

    def test_does_not_mix_legacy_keys_into_runtime_shape(self):
        state = storage.ensure_runtime_state_shape(
            {"alerts": {"demo": {"attempts": 2}}, "history": []}
        )

        self.assertEqual(state["runtime"], {})
        self.assertEqual(state["alerts"]["demo"]["attempts"], 2)


if __name__ == "__main__":
    unittest.main()
