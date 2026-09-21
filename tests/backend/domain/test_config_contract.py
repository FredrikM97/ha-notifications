import json
import unittest
from pathlib import Path

from homeassistant import config_entries

from custom_components.ha_notifications import config_flow
from tests.backend.support.test_support import load_const_and_models

const, models = load_const_and_models()


class ConfigContractTests(unittest.TestCase):
    def test_ui_config_flow_is_registered(self):
        manifest_path = (
            Path(__file__).parents[3]
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
        self.assertTrue(
            hasattr(config_flow.HaNotificationsConfigFlow, "async_step_reconfigure")
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
                    "monitor": {"on_change": True, "interval": 1800},
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
        self.assertEqual(alert["monitor"]["interval"], 1800)
        self.assertNotIn("trigger", alert)
        self.assertNotIn("logic", alert)
        self.assertNotIn("notify_on_start", alert)

if __name__ == "__main__":
    unittest.main()
