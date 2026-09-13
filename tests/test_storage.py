"""Tests for YAML parsing and persistence safeguards."""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from test_support import load_storage

storage = load_storage()


class FakeStore:
    def __init__(self, value=None):
        self.value = value
        self.saved = []
        self.delayed = []

    async def async_load(self):
        return self.value

    def async_delay_save(self, callback, delay):
        self.delayed.append((callback(), delay))

    async def async_save(self, value):
        self.saved.append(value)


class FakeConfig:
    def __init__(self, root: Path):
        self.root = root

    def path(self, filename: str) -> str:
        return str(self.root / filename)


class FakeHass:
    def __init__(self, root: Path, store_value=None):
        self.config = FakeConfig(root)
        self.store = FakeStore(store_value)

    async def async_add_executor_job(self, function, *args):
        return function(*args)


class YAMLHelperTests(unittest.TestCase):
    def test_parse_yaml_accepts_empty_and_mapping_documents(self):
        self.assertEqual(storage._parse_yaml(""), {})
        self.assertEqual(storage._parse_yaml("alerts: []"), {"alerts": []})

    def test_parse_yaml_rejects_non_mapping_documents(self):
        with self.assertRaisesRegex(ValueError, "must contain a mapping"):
            storage._parse_yaml("- alert")

    def test_write_text_replaces_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "config.yaml"
            storage._write_text(path, "alerts: []\n")
            self.assertEqual(path.read_text(encoding="utf-8"), "alerts: []\n")
            self.assertFalse(path.with_suffix(".yaml.tmp").exists())


class NotificationStorageTests(unittest.TestCase):
    def run_async(self, coroutine):
        return asyncio.run(coroutine)

    def test_validate_yaml_does_not_write(self):
        with tempfile.TemporaryDirectory() as directory:
            hass = FakeHass(Path(directory))
            instance = storage.NotificationStorage(hass)
            result = self.run_async(
                instance.async_validate_yaml_text(
                    "alerts:\n  - name: Test\n    conditions:\n"
                    "      - type: template\n        template: '{{ true }}'\n"
                )
            )

            self.assertEqual(result["alerts"][0]["id"], "test")
            self.assertFalse(instance.yaml_path.exists())

    def test_save_yaml_normalizes_and_persists(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = storage.NotificationStorage(FakeHass(Path(directory)))
            result = self.run_async(
                instance.async_save_yaml_text(
                    "alerts:\n  - name: Test\n    conditions:\n"
                    "      - type: template\n        template: '{{ true }}'\n"
                )
            )

            self.assertEqual(result["version"], 1)
            self.assertTrue(instance.yaml_path.exists())
            saved = instance.yaml_path.read_text(encoding="utf-8")
            self.assertIn("version: 1", saved)
            self.assertIn("id: test", saved)

    def test_saved_yaml_contains_one_canonical_notification_key(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = storage.NotificationStorage(FakeHass(Path(directory)))
            self.run_async(
                instance.async_save_config(
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
                                "notifications": [
                                    {"action": "notify.legacy"},
                                ],
                            }
                        ],
                    }
                )
            )

            saved = instance.yaml_path.read_text(encoding="utf-8")
            self.assertEqual(saved.count("notification:"), 1)
            self.assertNotIn("notifications:", saved)

    def test_saved_yaml_repairs_stale_browser_duration_text(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = storage.NotificationStorage(FakeHass(Path(directory)))
            self.run_async(
                instance.async_save_config(
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
            )

            saved = instance.yaml_path.read_text(encoding="utf-8")
            self.assertNotIn("[object Object]", saved)
            self.assertIn("resend_interval:", saved)
            self.assertIn("minutes: 30", saved)

    def test_invalid_yaml_cannot_replace_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = storage.NotificationStorage(FakeHass(Path(directory)))
            self.run_async(instance.async_save_yaml_text("alerts: []\n"))
            original = instance.yaml_path.read_text(encoding="utf-8")

            with self.assertRaises(ValueError):
                self.run_async(instance.async_save_yaml_text("- invalid\n"))

            self.assertEqual(
                instance.yaml_path.read_text(encoding="utf-8"),
                original,
            )

    def test_load_state_repairs_invalid_shapes(self):
        with tempfile.TemporaryDirectory() as directory:
            hass = FakeHass(
                Path(directory),
                store_value={"alerts": [], "history": "invalid"},
            )
            instance = storage.NotificationStorage(hass)
            instance.store = hass.store
            state = self.run_async(instance.async_load_state())

            self.assertEqual(state["alerts"], {})
            self.assertEqual(state["history"], [])

    def test_state_saves_use_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            hass = FakeHass(Path(directory))
            instance = storage.NotificationStorage(hass)
            instance.store = hass.store
            state = {"alerts": {"one": {"active": True}}, "history": []}

            instance.async_delay_save_state(state)
            state["alerts"]["one"]["active"] = False

            self.assertTrue(hass.store.delayed[0][0]["alerts"]["one"]["active"])

            self.run_async(instance.async_save_state_now(state))
            self.assertFalse(hass.store.saved[0]["alerts"]["one"]["active"])


if __name__ == "__main__":
    unittest.main()
