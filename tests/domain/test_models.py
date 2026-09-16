"""Tests for direct Pydantic configuration and feature models."""

from __future__ import annotations

import unittest
from datetime import timedelta

from custom_components.ha_notifications.domain.durations import (
    duration_seconds,
    parse_duration,
)
from custom_components.ha_notifications.features.confirmation import (
    ConfirmationConfig,
)
from custom_components.ha_notifications.features.notification import (
    NotificationConfig,
)
from tests.conftest import alert_fixture
from tests.support.test_support import load_const_and_models

_, models = load_const_and_models()


def test_configuration_model_contract_snapshot(snapshot):
    alert = alert_fixture("configuration")
    configuration = models.Configuration.model_validate(
        {
            "alerts": [alert]
        }
    )

    assert configuration.model_dump(exclude_none=True) == snapshot


class DurationTests(unittest.TestCase):
    def test_parse_supported_values(self):
        cases = (
            (None, None),
            ("", None),
            (timedelta(seconds=4), timedelta(seconds=4)),
            (90, timedelta(seconds=90)),
            ({"days": 1, "minutes": 2}, timedelta(days=1, minutes=2)),
            ("12:34", timedelta(hours=12, minutes=34)),
        )
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(parse_duration(value), expected)

    def test_invalid_values_raise(self):
        with self.assertRaises(ValueError):
            parse_duration("nope")

    def test_duration_seconds_normalizes_frontend_values(self):
        self.assertIsNone(duration_seconds(None))
        self.assertEqual(duration_seconds("00:30"), 1800)
        self.assertEqual(duration_seconds({"seconds": 1.5}), 1.5)
        self.assertEqual(duration_seconds(4), 4)

class ConfigurationTests(unittest.TestCase):
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
                "confirmation": {"enabled": True, "button": "Done"},
            }
        )
        mapped = alert.model_dump(exclude_none=True)
        self.assertEqual(alert.id, "kitchen_lights")
        self.assertEqual(alert.model_extra["logic"], "any")
        self.assertIn("notifications", mapped)
        self.assertTrue(alert.confirmation["enabled"])

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
        confirmation = ConfirmationConfig.model_validate({"button": "Acknowledge"})
        notification = NotificationConfig.model_validate({})
        confirmation.button = "Done"
        self.assertEqual(confirmation.button, "Done")
        self.assertEqual(notification.model_dump(exclude_none=True), {})

    def test_alert_runtime_accepts_last_event_entry(self):
        runtime = models.AlertRuntime.model_validate(
            {
                "last_event": {
                    "type": "notification_failed",
                    "message": "Notification failed.",
                    "details": {"attempt": 1, "error": "boom"},
                }
            }
        )
        self.assertEqual(runtime.last_event["details"]["attempt"], 1)


if __name__ == "__main__":
    unittest.main()
