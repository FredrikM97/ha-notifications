import unittest
import json
from datetime import timedelta
from pathlib import Path

from homeassistant import config_entries

from test_support import load_const_and_models

from custom_components.ha_notifications import config_flow
from custom_components.ha_notifications.domain.durations import parse_duration

const, models = load_const_and_models()


class ConfigContractTests(unittest.TestCase):
    def test_ui_config_flow_is_registered(self):
        manifest_path = (
            Path(__file__).parents[1]
            / "custom_components"
            / "ha_notifications"
            / "manifest.json"
        )
        manifest = json.loads(manifest_path.read_text())

        self.assertTrue(manifest["config_flow"])
        self.assertIs(
            config_entries.HANDLERS[const.DOMAIN],
            config_flow.HaNotificationsConfigFlow,
        )

    def test_remove_callback_is_defined(self):
        from custom_components.ha_notifications import async_remove_entry

        self.assertTrue(callable(async_remove_entry))

    def test_config_version_defined(self):
        self.assertEqual(const.CONFIG_VERSION, 1)

    def test_normalize_config_has_canonical_monitor(self):
        config = {
            "version": 1,
            "alerts": [
                {
                    "id": "demo",
                    "name": "Demo",
                    "enabled": True,
                    "conditions": [
                        {"type": "template", "template": "{{ true }}"}
                    ],
                    "monitor": {"on_change": True, "interval": "00:30"},
                    "notification": {
                        "action": "notify.test",
                        "target": {"entity_id": ["notify.a"]},
                        "title": "Hi",
                        "message": "Hey",
                    },
                }
            ],
        }

        normalized = models.Configuration.model_validate(config).model_dump(
            exclude_none=True
        )
        alert = normalized["alerts"][0]

        self.assertEqual(normalized["version"], 1)
        self.assertTrue(alert["monitor"]["on_change"])
        self.assertEqual(alert["monitor"]["interval"], "00:30")
        self.assertNotIn("trigger", alert)
        self.assertNotIn("logic", alert)
        self.assertNotIn("notify_on_start", alert)

    def test_parse_duration_time_strings(self):
        self.assertEqual(parse_duration("12:00"), timedelta(hours=12))
        self.assertEqual(parse_duration("00:30"), timedelta(minutes=30))
        self.assertEqual(parse_duration("12:00:00"), timedelta(hours=12))
        self.assertEqual(parse_duration("00:30:00"), timedelta(minutes=30))


if __name__ == "__main__":
    unittest.main()
