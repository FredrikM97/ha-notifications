"""Tests for raw configuration and event persistence."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from pydantic import ValidationError

from tests.backend.support.test_support import load_storage

storage_module = load_storage()


class FakeConfigEntries:
    def async_update_entry(self, entry, *, options):
        entry.options = options


class FakeHass:
    config_entries = FakeConfigEntries()


class FakeEntry:
    def __init__(self, options=None):
        self.options = options or {}


class FakeStore:
    def __init__(self, loaded=None):
        self.loaded = loaded
        self.saved = None
        self.delayed = None

    async def async_load(self):
        return self.loaded

    async def async_save(self, value):
        self.saved = value

    async def async_remove(self):
        self.loaded = None

    def async_delay_save(self, callback, _delay):
        self.delayed = callback()


class StorageTests(unittest.IsolatedAsyncioTestCase):
    def make_storage(self, history_backend=None):
        if history_backend is None:
            history_backend = FakeStore()
        with patch.object(storage_module, "Store", return_value=history_backend):
            return storage_module.Storage(FakeHass(), FakeEntry())

    async def test_configuration_is_stored_unchanged(self):
        entry = FakeEntry()
        with patch.object(storage_module, "Store", return_value=FakeStore()):
            storage = storage_module.Storage(FakeHass(), entry)
        config = {
            "version": 1,
            "alerts": [
                {"id": "demo", "name": "Demo", "runtime": {"active": True}}
            ],
        }

        saved = await storage.save_config(config)

        self.assertIs(saved, config)
        self.assertIs(entry.options, config)
        self.assertIs(await storage.load_config(), config)

    async def test_invalid_configuration_does_not_replace_existing_options(self):
        entry = FakeEntry(
            {
                "version": 1,
                "alerts": [{"id": "demo", "name": "Demo"}],
            }
        )
        with patch.object(storage_module, "Store", return_value=FakeStore()):
            storage = storage_module.Storage(FakeHass(), entry)

        original = entry.options
        invalid = {"version": 1, "alerts": [{"name": "Missing id"}]}

        with self.assertRaises(ValidationError):
            await storage.save_config(invalid)

        self.assertIs(entry.options, original)
        self.assertEqual(await storage.load_config(), original)

    async def test_invalid_existing_configuration_is_not_returned(self):
        entry = FakeEntry({"version": 1, "alerts": [{"name": "Missing id"}]})
        storage = self.make_storage()
        storage._entry = entry

        with self.assertRaises(ValidationError):
            await storage.load_config()

    async def test_event_object_is_stored_unchanged(self):
        store = FakeStore()
        persistence = self.make_storage(history_backend=store)
        event = {"type": "notification_sent", "nested": {"value": 1}}

        await persistence.store_event(event)

        self.assertIs(persistence.history[0], event)
        self.assertIs(store.delayed, persistence.history)

    async def test_loaded_history_replaces_shared_state(self):
        loaded = [{"type": "notification_sent"}]
        persistence = self.make_storage(history_backend=FakeStore(loaded))

        await persistence.load_history()

        self.assertEqual(persistence.history, loaded)

    async def test_remove_history_for_alert_persists_updated_state(self):
        store = FakeStore(
            [
                {"alert": {"id": "removed"}, "event": {"type": "notification_sent"}},
                {"alert": {"id": "kept"}, "event": {"type": "notification_sent"}},
            ]
        )
        persistence = self.make_storage(history_backend=store)

        await persistence.remove_history_for_alert("removed")

        self.assertEqual(
            persistence.history,
            [{"alert": {"id": "kept"}, "event": {"type": "notification_sent"}}],
        )
        self.assertEqual(store.delayed, persistence.history)


if __name__ == "__main__":
    unittest.main()
