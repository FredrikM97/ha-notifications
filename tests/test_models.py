"""Tests for configuration normalization and condition compilation."""

from __future__ import annotations

import unittest
from datetime import timedelta

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
                    "user_id": "a-user-id",
                    "ignored": "value",
                }
            ),
            {
                "entity_id": ["light.kitchen"],
                "device_id": ["phone"],
                "user_id": ["a-user-id"],
                "ignored": ["value"],
            },
        )
        self.assertEqual(models.normalize_target(None), {})

    def test_condition_and_notification_shapes_are_normalized(self):
        condition = models.normalize_condition(
            {"type": "template", "template": "{{ true }}"}
        )
        notification = models.normalize_notification(
            {
                "action": "notify.mobile",
                "target": {"entity_id": "notify.phone"},
                "title": "Title",
                "message": "Message",
                "data": {"tag": "reminder"},
            },
            {"title": "Default title"},
        )

        self.assertEqual(
            condition,
            {"type": "template", "template": "{{ true }}"},
        )
        self.assertEqual(notification["title"], "Title")
        self.assertEqual(notification["message"], "Message")
        self.assertEqual(notification["data"], {"tag": "reminder"})
        self.assertEqual(notification["target"], {"entity_id": ["notify.phone"]})
        self.assertNotIn("persistent", notification)
        self.assertTrue(notification["confirmation"]["clear_on_confirmation"])

    def test_legacy_persistent_notification_setting_is_ignored(self):
        notification = models.normalize_notification(
            {
                "persistent": True,
                "confirmation": {"clear_on_confirmation": False},
            }
        )

        self.assertNotIn("persistent", notification)
        self.assertFalse(notification["confirmation"]["clear_on_confirmation"])

    def test_feature_fields_are_preserved_during_normalization(self):
        normalized = models.normalize_alert(
            {
                "name": "Extensible",
                "feature_state": {"enabled": True},
                "notification": {
                    "target": {"entity_id": ["notify.phone"]},
                    "delivery_options": {"priority": "high"},
                },
            }
        )

        self.assertEqual(normalized["feature_state"], {"enabled": True})
        self.assertEqual(
            normalized["notification"]["delivery_options"],
            {"priority": "high"},
        )

    def test_recipient_types_are_extensible(self):
        notification = models.normalize_notification(
            {"target": {"team_id": "on_call", "user_id": ["user_1"]}}
        )

        self.assertEqual(
            notification["target"],
            {"team_id": ["on_call"], "user_id": ["user_1"]},
        )

    def test_registered_feature_can_add_alert_fields(self):
        normalizer = models.ConfigNormalizer(
            [
                models.AlertFeature(
                    "test-feature",
                    lambda alert: {**alert, "feature": {"enabled": True}},
                )
            ]
        )

        normalized = normalizer.normalize_alert_document({"name": "Featured"})

        self.assertEqual(normalized["feature"], {"enabled": True})

    def test_confirmation_data_is_preserved(self):
        alert = models.normalize_alert(
            {
                "name": "Legacy reminder",
                "notification": {
                    "action": "notify.mobile",
                    "confirmation": {
                        "enabled": True,
                        "button": "Done",
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

    def test_enabled_confirmation_is_present_in_runtime_notification(self):
        alert = models.normalize_config(
            {
                "alerts": [
                    {
                        "name": "Android action",
                        "conditions": [{"type": "template", "template": "{{ true }}"}],
                        "notification": {
                            "action": "notify.mobile_app_phone",
                            "confirmation": {
                                "enabled": True,
                                "button": "Done",
                            },
                        },
                    }
                ]
            }
        )["alerts"][0]

        self.assertTrue(alert["notification"]["confirmation"]["enabled"])
        self.assertEqual(
            alert["notification"]["confirmation"]["button"],
            "Done",
        )

    def test_alert_normalizes_canonical_fields(self):
        alert = models.normalize_alert(
            {
                "name": "Kitchen lights",
                "conditions": [
                    {
                        "type": "template",
                        "template": "{{ is_state('light.kitchen', 'on') }}",
                    }
                ],
                "notification": {
                    "action": "notify.mobile",
                    "message": "Lights are on",
                    "repeat": {"interval": "00:30", "max_attempts": 3},
                    "confirmation": {"enabled": True, "button": "Done"},
                },
                "monitor": {"interval": "01:00:00"},
            }
        )

        self.assertEqual(alert["id"], "kitchen_lights")
        self.assertEqual(alert["conditions"][0]["type"], "template")
        self.assertEqual(alert["monitor"]["interval"], "01:00:00")
        self.assertNotIn("notifications", alert)
        self.assertNotIn("trigger", alert)
        self.assertNotIn("logic", alert)
        self.assertNotIn("confirmation", alert)
        self.assertEqual(alert["notification"]["repeat"]["interval"], "00:30")
        self.assertEqual(alert["notification"]["confirmation"]["button"], "Done")
        self.assertEqual(alert["notification"]["confirmation"]["max_attempts"], 5)
        self.assertEqual(
            alert["notification"]["confirmation"]["resend_interval"],
            {"minutes": 30},
        )
        self.assertFalse(alert["notification"]["confirmation"]["actions_enabled"])
        self.assertFalse(
            alert["notification"]["confirmation"]["notify_on_confirmation"]
        )

    def test_monitor_interval_accepts_mapping_and_discards_browser_object_text(self):
        mapped = models.normalize_alert(
            {
                "name": "Mapped interval",
                "monitor": {"interval": {"minutes": 20}},
            }
        )
        stale = models.normalize_alert(
            {
                "name": "Stale interval",
                "monitor": {"interval": "[object Object]"},
            }
        )

        self.assertEqual(mapped["monitor"]["interval"], "00:20:00")
        self.assertNotIn("interval", stale["monitor"])

    def test_notification_durations_discard_browser_object_text(self):
        alert = models.normalize_alert(
            {
                "name": "Stale notification durations",
                "notification": {
                    "repeat": {
                        "interval": "[object Object]",
                        "max_attempts": 3,
                    },
                    "confirmation": {
                        "enabled": True,
                        "resend_interval": "[object Object]",
                    },
                },
            }
        )

        self.assertEqual(alert["notification"]["repeat"]["interval"], "00:30")
        self.assertEqual(
            alert["notification"]["confirmation"]["resend_interval"],
            {"minutes": 30},
        )

    def test_condition_for_discards_browser_object_text(self):
        alert = models.normalize_alert(
            {
                "name": "Stale condition duration",
                "conditions": [
                    {
                        "type": "state",
                        "entity_id": "sensor.water",
                        "state": "low",
                        "for": "[object Object]",
                    }
                ],
            }
        )

        self.assertNotIn("for", alert["conditions"][0])

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
            all("action" not in item["notification"] for item in normalized["alerts"])
        )

    def test_confirmation_actions_have_explicit_enabled_state_and_omit_empty_list(self):
        disabled = models.normalize_alert(
            {
                "name": "No actions",
                "notification": {
                    "confirmation": {"enabled": True},
                },
            }
        )
        confirmation = disabled["notification"]["confirmation"]
        self.assertFalse(confirmation["actions_enabled"])
        self.assertNotIn("actions", confirmation)

        enabled = models.normalize_alert(
            {
                "name": "With actions",
                "notification": {
                    "confirmation": {
                        "enabled": True,
                        "actions_enabled": True,
                        "actions": [
                            {"action": "light.turn_on"},
                        ],
                    },
                },
            }
        )
        confirmation = enabled["notification"]["confirmation"]
        self.assertTrue(confirmation["actions_enabled"])
        self.assertEqual(len(confirmation["actions"]), 1)

    def test_notification_actions_and_confirmation_notice_are_normalized(self):
        alert = models.normalize_alert(
            {
                "name": "With post-send behavior",
                "notification": {
                    "actions_enabled": True,
                    "actions": [{"action": "light.turn_on"}],
                    "confirmation": {
                        "notify_on_confirmation": True,
                        "confirmation_message": "{{ confirmed_by }} confirmed.",
                    },
                },
            }
        )

        notification = alert["notification"]
        self.assertTrue(notification["actions_enabled"])
        self.assertEqual(notification["actions"], [{"action": "light.turn_on"}])
        self.assertTrue(notification["confirmation"]["notify_on_confirmation"])
        self.assertEqual(
            notification["confirmation"]["confirmation_message"],
            "{{ confirmed_by }} confirmed.",
        )

    def test_alert_metadata_is_preserved(self):
        alert = models.normalize_alert(
            {
                "name": "Editable",
                "description": "Keep this",
                "icon": "mdi:test",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-02T00:00:00+00:00",
            }
        )
        self.assertEqual(alert["description"], "Keep this")
        self.assertEqual(alert["icon"], "mdi:test")
        self.assertEqual(alert["created_at"], "2026-01-01T00:00:00+00:00")
        self.assertEqual(alert["updated_at"], "2026-01-02T00:00:00+00:00")

    def test_invalid_alert_collection_is_rejected(self):
        with self.assertRaises(ValueError):
            models.normalize_config({"alerts": "invalid"})


class ConditionCompilationTests(unittest.TestCase):
    def test_compiles_state_numeric_attribute_and_template_conditions(self):
        compiled = models.compile_condition(
            {
                "logic": "all",
                "conditions": [
                    {
                        "type": "state",
                        "entity_id": "binary_sensor.door",
                        "state": "on",
                        "for": "00:05",
                    },
                    {
                        "type": "numeric",
                        "entity_id": "sensor.temp",
                        "above": 20,
                        "below": 30,
                    },
                    {
                        "type": "attribute",
                        "entity_id": "climate.room",
                        "attribute": "mode",
                        "value": "heat",
                    },
                    {
                        "type": "template",
                        "template": "is_state('input_boolean.away', 'off')",
                    },
                ],
            }
        )

        self.assertIn('is_state("binary_sensor.door", "on")', compiled)
        self.assertIn("total_seconds() >= 300", compiled)
        self.assertIn('states("sensor.temp") | float(0) > 20.0', compiled)
        self.assertIn('states("sensor.temp") | float(0) < 30.0', compiled)
        self.assertIn('state_attr("climate.room", "mode") == "heat"', compiled)
        self.assertIn("is_state('input_boolean.away', 'off')", compiled)
        self.assertIn(" and ", compiled)

    def test_multiple_conditions_are_combined_with_and(self):
        compiled = models.compile_condition(
            {
                "conditions": [
                    {"type": "state", "entity_id": "sensor.one", "state": "on"},
                    {"type": "state", "entity_id": "sensor.two", "state": "off"},
                ],
            }
        )
        self.assertIn(" and ", compiled)
        self.assertNotIn(" or ", compiled)
        self.assertEqual(models.compile_condition({"conditions": []}), "{{ true }}")

    def test_notification_is_normalized_to_one_notification(self):
        alert = models.normalize_alert(
            {
                "name": "Canonical",
                "notification": {
                    "action": "notify.first",
                    "message": "First",
                },
            }
        )
        self.assertNotIn("action", alert["notification"])

    def test_template_expression_is_not_double_wrapped(self):
        compiled = models.compile_condition(
            {
                "conditions": [
                    {
                        "type": "template",
                        "template": "{{ false }}",
                    }
                ]
            }
        )

        self.assertIn("{% set nc_condition_0 = (false) %}", compiled)
        self.assertIn("{{ (nc_condition_0 | bool) }}", compiled)

    def test_blank_template_condition_defaults_to_true(self):
        self.assertEqual(
            models.compile_condition(
                {"conditions": [{"type": "template", "template": "{{   }}"}]}
            ),
            "{{ true }}",
        )

    def test_block_template_condition_is_not_wrapped_as_expression(self):
        compiled = models.compile_condition(
            {
                "conditions": [
                    {
                        "type": "template",
                        "template": "{% set threshold = 20 %}\n{{ threshold > 10 }}",
                    }
                ]
            }
        )

        self.assertIn("{% set nc_condition_0 %}", compiled)
        self.assertIn("{% set threshold = 20 %}", compiled)
        self.assertIn("{% endset %}", compiled)
        self.assertIn("{{ (nc_condition_0 | bool) }}", compiled)

    def test_any_conditions_support_lists_and_numeric_duration(self):
        alert = models.normalize_alert(
            {
                "name": "Condition set",
                "logic": "any",
                "conditions": [
                    {
                        "type": "state",
                        "entity_id": ["sensor.water_level"],
                        "state": ["low"],
                        "id": "low_water",
                    },
                    {
                        "type": "numeric",
                        "entity_id": ["sensor.filter_duration"],
                        "above": 29,
                        "for": {"seconds": 0},
                    },
                    {
                        "alias": "Battery low detection",
                        "type": "template",
                        "template": "{{ true }}",
                        "enabled": False,
                    },
                ],
            }
        )

        self.assertEqual(alert["logic"], "any")
        self.assertEqual(alert["conditions"][0]["type"], "state")
        self.assertEqual(alert["conditions"][0]["state"], ["low"])
        self.assertEqual(alert["conditions"][1]["type"], "numeric")

        compiled = models.compile_condition(alert)

        self.assertIn('is_state("sensor.water_level", "low")', compiled)
        self.assertIn('states("sensor.filter_duration") | float(0) > 29.0', compiled)
        self.assertIn(" or ", compiled)
        self.assertNotIn("Battery low detection", compiled)

    def test_numeric_condition_needs_entity_id_not_registry_id(self):
        condition = models.normalize_condition(
            {
                "type": "numeric",
                "entity_id": "sensor.cat_food",
                "below": 20,
            }
        )

        self.assertEqual(condition["type"], "numeric")
        self.assertEqual(condition["entity_id"], "sensor.cat_food")


if __name__ == "__main__":
    unittest.main()
