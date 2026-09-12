"""Tests for configuration normalization and condition compilation."""

from __future__ import annotations

from datetime import timedelta
import unittest

from test_support import load_const_and_models


_, models = load_const_and_models()


class DurationTests(unittest.TestCase):
    def test_parse_supported_values(self):
        cases = (
            (None, None),
            ("", None),
            (timedelta(seconds=4), timedelta(seconds=4)),
            (90, timedelta(seconds=90)),
            (1.5, timedelta(seconds=1.5)),
            ({"days": 1, "minutes": 2}, timedelta(days=1, minutes=2)),
            ("12:34", timedelta(hours=12, minutes=34)),
            ("12:34:56", timedelta(hours=12, minutes=34, seconds=56)),
            ("90", timedelta(seconds=90)),
        )

        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(models.parse_duration(value), expected)

    def test_parse_invalid_values(self):
        for value in ("nope", object()):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    models.parse_duration(value)

    def test_default_is_used_for_missing_or_blank_values(self):
        default = timedelta(minutes=3)
        self.assertEqual(models.parse_duration(None, default), default)
        self.assertEqual(models.parse_duration("", default), default)

    def test_duration_to_mapping_omits_zero_units(self):
        self.assertEqual(
            models.duration_to_mapping("1:02:03"),
            {"hours": 1, "minutes": 2, "seconds": 3},
        )
        self.assertEqual(models.duration_to_mapping(None), {})
        self.assertEqual(models.duration_to_mapping(0), {"seconds": 0})

    def test_duration_to_string_preserves_hours_and_uses_default(self):
        self.assertEqual(models.duration_to_string("1:02:03"), "01:02:03")
        self.assertEqual(models.duration_to_string("27:00"), "27:00:00")
        self.assertEqual(models.duration_to_string(None), "00:00:00")
        self.assertEqual(
            models.duration_to_string(None, "12:00:00"),
            "12:00:00",
        )


class NormalizationTests(unittest.TestCase):
    def test_target_accepts_scalar_and_list_values(self):
        self.assertEqual(
            models.normalize_target(
                {
                    "entity_id": "light.kitchen",
                    "device_id": ["phone", ""],
                    "ignored": "value",
                }
            ),
            {
                "entity_id": ["light.kitchen"],
                "device_id": ["phone"],
            },
        )
        self.assertEqual(models.normalize_target(None), {})

    def test_condition_and_notification_legacy_shapes_are_normalized(self):
        condition = models.normalize_condition("{{ true }}")
        notification = models.normalize_notification(
            {
                "action": "notify.mobile",
                "target": {"entity_id": "notify.phone"},
                "data": {
                    "title": "Legacy title",
                    "message": "Legacy message",
                    "tag": "reminder",
                },
            },
            {"title": "Default title"},
        )

        self.assertEqual(
            condition,
            {"type": "template", "template": "{{ true }}"},
        )
        self.assertEqual(notification["title"], "Default title")
        self.assertEqual(notification["message"], "Legacy message")
        self.assertEqual(notification["data"], {"tag": "reminder"})
        self.assertEqual(notification["target"], {"entity_id": ["notify.phone"]})

    def test_legacy_confirmation_data_is_preserved(self):
        alert = models.normalize_alert(
            {
                "name": "Legacy reminder",
                "notification": {
                    "action": "notify.mobile",
                    "data": {
                        "confirmation_button": "Done",
                        "completion_message": "Completed",
                        "max_attempts": 3,
                    },
                },
            }
        )

        confirmation = alert["notification"]["confirmation"]
        self.assertTrue(confirmation["enabled"])
        self.assertEqual(confirmation["button"], "Done")
        self.assertEqual(confirmation["completion_message"], "Completed")
        self.assertEqual(confirmation["max_attempts"], 3)

    def test_alert_normalizes_legacy_fields_and_preserves_runtime_aliases(self):
        alert = models.normalize_alert(
            {
                "name": "Kitchen lights",
                "condition": "{{ is_state('light.kitchen', 'on') }}",
                "notification": {
                    "action": "notify.mobile",
                    "message": "Lights are on",
                    "repeat": {"interval": "00:30", "max_attempts": 3},
                    "confirmation": {"enabled": True, "button": "Done"},
                },
                "trigger": {"interval": "01:00:00"},
                "confirmation": {"max_attempts": 99},
            }
        )

        self.assertEqual(alert["id"], "kitchen_lights")
        self.assertEqual(alert["conditions"][0]["type"], "template")
        self.assertEqual(alert["monitor"]["interval"], "01:00:00")
        self.assertEqual(alert["notification"], alert["notifications"][0])
        self.assertEqual(alert["notification"]["repeat"]["interval"], "00:30")
        self.assertEqual(alert["notification"]["confirmation"]["button"], "Done")
        self.assertEqual(alert["notification"]["confirmation"]["max_attempts"], 20)
        self.assertEqual(
            alert["notification"]["confirmation"]["resend_interval"],
            {"minutes": 30},
        )
        self.assertEqual(alert["confirmation"]["max_attempts"], 20)

    def test_config_accepts_alert_mapping_and_applies_defaults(self):
        normalized = models.normalize_config(
            {
                "defaults": {
                    "notification": {
                        "action": "notify.default",
                        "title": "Default",
                    }
                },
                "alerts": {
                    "one": {"name": "One"},
                    "two": {"name": "Two"},
                },
            }
        )

        self.assertEqual(normalized["version"], 1)
        self.assertEqual(len(normalized["alerts"]), 2)
        self.assertTrue(all(item["enabled"] for item in normalized["alerts"]))
        self.assertTrue(
            all(item["notification"]["action"] == "notify.default" for item in normalized["alerts"])
        )

    def test_invalid_alert_collection_is_rejected(self):
        with self.assertRaises(ValueError):
            models.normalize_config({"alerts": "invalid"})


class ConditionCompilationTests(unittest.TestCase):
    def test_compiles_state_numeric_attribute_and_template_conditions(self):
        compiled = models.compile_condition(
            {
                "logic": "all",
                "conditions": [
                    {"type": "state", "entity_id": "binary_sensor.door", "state": "on", "for": "00:05"},
                    {"type": "numeric", "entity_id": "sensor.temp", "above": 20, "below": 30},
                    {"type": "attribute", "entity_id": "climate.room", "attribute": "mode", "value": "heat"},
                    {"type": "template", "template": "is_state('input_boolean.away', 'off')"},
                ],
            }
        )

        self.assertIn("is_state(\"binary_sensor.door\", \"on\")", compiled)
        self.assertIn("total_seconds() >= 300", compiled)
        self.assertIn("states(\"sensor.temp\") | float(0) > 20.0", compiled)
        self.assertIn("states(\"sensor.temp\") | float(0) < 30.0", compiled)
        self.assertIn("state_attr(\"climate.room\", \"mode\") == \"heat\"", compiled)
        self.assertIn("is_state('input_boolean.away', 'off')", compiled)
        self.assertIn(" and ", compiled)

    def test_any_logic_and_empty_conditions(self):
        compiled = models.compile_condition(
            {
                "logic": "any",
                "conditions": [
                    {"type": "state", "entity_id": "sensor.one", "state": "on"},
                    {"type": "state", "entity_id": "sensor.two", "state": "off"},
                ],
            }
        )
        self.assertIn(" or ", compiled)
        self.assertEqual(models.compile_condition({"conditions": []}), "{{ true }}")


if __name__ == "__main__":
    unittest.main()
