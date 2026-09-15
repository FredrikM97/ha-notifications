"""Tests for direct Pydantic configuration and feature models."""

from __future__ import annotations

import unittest
from datetime import timedelta

from test_support import load_const_and_models

from custom_components.notification_center.domain.durations import (
    duration_to_mapping,
    duration_to_string,
    parse_duration,
)
from custom_components.notification_center.features.confirmation import (
    ConfirmationConfig,
)
from custom_components.notification_center.features.notification import (
    NotificationConfig,
)

_, models = load_const_and_models()


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

    def test_duration_serialization(self):
        self.assertEqual(
            duration_to_mapping("1:02:03"),
            {"hours": 1, "minutes": 2, "seconds": 3},
        )
        self.assertEqual(duration_to_string("27:00"), "27:00:00")


class ConfigurationTests(unittest.TestCase):
    def test_alert_features_are_registered_by_feature_modules(self):
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
                "conditions",
                "notification",
                "confirmation",
                "post_send_actions",
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
        self.assertTrue(alert.confirmation.enabled)

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
        self.assertIsNone(config.alerts[0].notification)

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
