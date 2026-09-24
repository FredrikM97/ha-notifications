"""Tests for direct Pydantic configuration and feature models."""

from __future__ import annotations

import unittest

from custom_components.ha_notifications.domain.runtime import (
    AlertRuntimeState,
    serialize_runtime,
)
from custom_components.ha_notifications.features.confirmations import (
    ConfirmationConfig,
)
from custom_components.ha_notifications.features.notification import (
    NotificationConfig,
)
from tests.backend.conftest import alert_fixture
from tests.backend.support.test_support import load_const_and_models

_, models = load_const_and_models()


def test_configuration_model_contract_snapshot(snapshot):
    alert = alert_fixture("configuration")
    configuration = models.Configuration.model_validate(
        {
            "alerts": [alert]
        }
    )

    assert configuration.model_dump(exclude_none=True) == snapshot


class ConfigurationTests(unittest.TestCase):
    def test_runtime_writes_complete_independent_state(self):
        runtime = AlertRuntimeState.for_alert({"id": "one"})
        target = {"stale": True}

        target = serialize_runtime(runtime)
        runtime.config["name"] = "Changed"

        self.assertNotIn("stale", target)
        self.assertNotIn("name", target["config"])

    def test_alert_owns_feature_sections_as_extra_fields(self):
        self.assertEqual(
            set(models.Alert.model_fields),
            {
                "id",
                "name",
                "enabled",
                "description",
                "icon",
                "created_at",
                "updated_at",
                "monitor",
            },
        )

    def test_alert_preserves_supplied_fields(self):
        alert = models.Alert.model_validate(
            {
                "id": "kitchen_lights",
                "name": "Kitchen lights",
                "logic": "any",
                "notifications": [{"action": "notify.legacy"}],
                "notification": {
                },
                "confirmation": {
                    "enabled": True,
                    "buttons": [{"id": "confirm", "label": "Done"}],
                },
            }
        )
        mapped = alert.model_dump(exclude_none=True)
        self.assertEqual(alert.id, "kitchen_lights")
        self.assertEqual(alert.model_extra["logic"], "any")
        self.assertIn("notifications", mapped)
        self.assertTrue(alert.confirmation["enabled"])

    def test_alert_entity_exposes_feature_fields_without_projection(self):
        alert = models.Alert.model_validate(
            {"id": "one", "name": "One", "notification": {"message": "Hi"}}
        )
        self.assertEqual(alert["id"], "one")
        self.assertEqual(alert["notification"]["message"], "Hi")
        self.assertEqual(dict(alert)["name"], "One")

    def test_configuration_accepts_supplied_alert_list(self):
        config = models.Configuration.model_validate(
            {
                "alerts": [
                    {"id": "one", "name": "One"},
                    {"id": "two", "name": "Two"},
                ],
            }
        )
        self.assertEqual(config.version, 1)
        self.assertEqual([alert.name for alert in config.alerts], ["One", "Two"])
        self.assertNotIn("notification", config.alerts[0].model_extra)

    def test_feature_models_are_mutable_typed_objects(self):
        confirmation = ConfirmationConfig.model_validate(
            {"buttons": [{"id": "confirm", "label": "Acknowledge"}]}
        )
        notification = NotificationConfig.model_validate({})
        confirmation.buttons[0].label = "Done"
        self.assertEqual(confirmation.buttons[0].label, "Done")
        self.assertEqual(notification.model_dump(exclude_none=True), {})

if __name__ == "__main__":
    unittest.main()
