"""Tests for pure YAML/state (de)serialization (storage.py)."""

from __future__ import annotations

import unittest

from tests.conftest import alert_fixture
from tests.support.test_support import load_storage

storage = load_storage()


def test_persisted_configuration_contract_snapshot(snapshot):
    alert = alert_fixture("persisted")
    alert["runtime"] = {"attempts": 4, "active": True}
    config = storage.Configuration.model_validate(
        {
            "version": 1,
            "alerts": [alert],
        }
    )

    assert storage.normalize_config(config) == snapshot


class ConfigEntryStorageTests(unittest.TestCase):
    def test_normalize_config_accepts_declared_alert_shape(self):
        result = storage.normalize_config(
            {
                "alerts": [
                    {
                        "id": "test",
                        "name": "Test",
                        "conditions": [
                            {"type": "template", "template": "{{ true }}"}
                        ],
                    }
                ]
            }
        )
        self.assertEqual(result["alerts"][0]["id"], "test")

    def test_invalid_config_raises_without_touching_anything(self):
        with self.assertRaises(ValueError):
            storage.normalize_config({"alerts": "invalid"})

    def test_normalize_and_dump_yaml_round_trips(self):
        alert = alert_fixture("persisted")
        alert["notification"]["action"] = "notify.mobile_app_phone"
        config = storage.Configuration.model_validate(
            {
                "version": 1,
                "alerts": [alert],
            }
        )
        normalized = storage.normalize_config(config)
        self.assertEqual(config.version, 1)
        self.assertEqual(normalized["alerts"][0]["id"], "demo")

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

    def test_drops_runtime_state_from_persisted_config(self):
        alert = alert_fixture("persisted")
        alert["runtime"] = {
            "active": True,
            "attempts": 20,
            "last_event": {"type": "notification_sent"},
        }
        config = storage.Configuration.model_validate(
            {
                "alerts": [alert]
            }
        )

        normalized = storage.normalize_config(config)

        self.assertNotIn("runtime", normalized["alerts"][0])
        self.assertNotIn("last_event", normalized["alerts"][0])


class RuntimeStateShapeTests(unittest.TestCase):
    def test_repairs_invalid_shapes(self):
        state = storage.ensure_runtime_state_shape(
            {"runtime": [], "history": "invalid"}
        )
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
