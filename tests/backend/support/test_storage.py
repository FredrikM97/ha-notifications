"""Tests for raw configuration and event persistence."""

from __future__ import annotations

import unittest

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
    async def test_configuration_is_stored_unchanged(self):
        entry = FakeEntry()
        storage = storage_module.Storage(
            FakeHass(), entry, FakeStore(), {"history": []}
        )
        config = {"version": 1, "alerts": [{"runtime": {"active": True}}]}

        saved = await storage.save_config(config)

        self.assertIs(saved, config)
        self.assertIs(entry.options, config)
        self.assertIs(await storage.load_config(), config)

    async def test_event_object_is_stored_unchanged(self):
        state = {"history": []}
        store = FakeStore()
        persistence = storage_module.Storage(FakeHass(), FakeEntry(), store, state)
        event = {"type": "notification_sent", "nested": {"value": 1}}

        persistence.store_event(event)

        self.assertIs(state["history"][0], event)
        self.assertIs(store.delayed, state)

    async def test_loaded_event_object_replaces_shared_state(self):
        state = {"history": []}
        loaded = {"runtime": {"demo": {"active": True}}, "history": []}
        persistence = storage_module.Storage(
            FakeHass(), FakeEntry(), FakeStore(loaded), state
        )

        await persistence.load_events()

        self.assertEqual(state, loaded)
        self.assertIsNot(state, loaded)


if __name__ == "__main__":
    unittest.main()
