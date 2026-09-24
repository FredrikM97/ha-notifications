"""Tests for raw configuration and event persistence."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from pydantic import ValidationError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_notifications.const import DOMAIN
from tests.backend.support.test_support import load_storage

storage_module = load_storage()


@pytest.fixture
def storage_entry_factory(hass: HomeAssistant):
    """Build real Home Assistant config entries for storage tests."""

    def build_entry(options=None) -> MockConfigEntry:
        entry = MockConfigEntry(domain=DOMAIN, data={}, options=options or {})
        entry.add_to_hass(hass)
        return entry

    return build_entry


@pytest.fixture
def storage_factory(hass: HomeAssistant, storage_entry_factory):
    """Build isolated Storage instances with explicit entry inputs."""

    def build_storage(entry=None, options=None):
        configured_entry = entry or storage_entry_factory(options)
        return storage_module.Storage(hass, configured_entry)

    return build_storage


async def test_configuration_is_stored_unchanged(
    storage_entry_factory, storage_factory
):
    entry = storage_entry_factory()
    storage = storage_factory(entry)
    config = {
        "version": 1,
        "alerts": [
            {"id": "demo", "name": "Demo", "runtime": {"active": True}}
        ],
    }

    saved = await storage.save_config(config)

    assert saved is config
    assert entry.options == config
    assert await storage.load_config() == config


async def test_invalid_configuration_does_not_replace_existing_options(
    storage_entry_factory,
    storage_factory,
):
    original = {
        "version": 1,
        "alerts": [{"id": "demo", "name": "Demo"}],
    }
    entry = storage_entry_factory(original)
    storage = storage_factory(entry)
    invalid = {"version": 1, "alerts": [{"name": "Missing id"}]}

    with pytest.raises(ValidationError):
        await storage.save_config(invalid)

    assert entry.options == original
    assert await storage.load_config() == original


async def test_new_configuration_rejects_legacy_duration_strings(
    storage_entry_factory,
    storage_factory,
):
    original = {
        "version": 1,
        "alerts": [{"id": "demo", "name": "Demo"}],
    }
    entry = storage_entry_factory(original)
    storage = storage_factory(entry)
    invalid = {
        "version": 1,
        "alerts": [
            {
                "id": "demo",
                "name": "Demo",
                "confirmation": {
                    "enabled": True,
                    "reminders": {"timeout": "00:15:00"},
                },
            }
        ],
    }

    with pytest.raises(ValidationError):
        await storage.save_config(invalid)

    assert entry.options["alerts"][0]["name"] == "Demo"


async def test_invalid_existing_configuration_is_not_returned(
    storage_entry_factory,
    storage_factory,
    caplog,
):
    entry = storage_entry_factory({"version": 1, "alerts": [{"name": "Missing id"}]})
    storage = storage_factory(entry)

    caplog.set_level("WARNING", logger=storage_module._LOGGER.name)
    assert await storage.load_config() == {"version": 1, "alerts": []}
    assert any("removed 1 alert" in record.message for record in caplog.records)


async def test_raw_configuration_preserves_invalid_saved_document(
    storage_entry_factory,
    storage_factory,
):
    options = {"version": 1, "alerts": [{"name": "Missing id"}]}
    entry = storage_entry_factory(options)
    storage = storage_factory(entry)

    raw = await storage.load_raw_config()

    assert raw == options
    assert raw is not entry.options
    assert entry.options["alerts"] == [{"name": "Missing id"}]


async def test_invalid_legacy_duration_data_is_removed_on_load(
    storage_entry_factory,
    storage_factory,
    caplog,
):
    options = {
        "version": 1,
        "alerts": [
            {
                "id": "demo",
                "name": "Demo",
                "notification": {"target": {"entity_id": ["notify.demo"]}},
                "confirmation": {
                    "enabled": True,
                    "reminders": {"timeout": "00:15:00"},
                },
            }
        ],
    }
    entry = storage_entry_factory(options)
    storage = storage_factory(entry)

    caplog.set_level("WARNING", logger=storage_module._LOGGER.name)
    loaded = await storage.load_config()

    assert loaded == {"version": 1, "alerts": []}
    assert any("removed 1 alert" in record.message for record in caplog.records)
    assert entry.options == loaded


async def test_event_object_is_stored_unchanged(storage_factory):
    storage = storage_factory()
    event = {"type": "notification_sent", "nested": {"value": 1}}

    await storage.store_event(event)

    assert storage.history[0] is event
    await storage.save_history()


async def test_loaded_history_replaces_shared_state(storage_factory):
    loaded = [{"type": "notification_sent"}]
    storage = storage_factory()
    await storage._history_store.async_save(loaded)

    await storage.load_history()

    assert storage.history == loaded


async def test_loaded_history_migrates_legacy_alert_key(storage_factory):
    loaded = [{"alert": {"id": "alert_1"}, "event": {"type": "sent"}}]
    storage = storage_factory()
    await storage._history_store.async_save(loaded)

    await storage.load_history()

    assert storage.history == [
        {"config": {"id": "alert_1"}, "event": {"type": "sent"}}
    ]


async def test_remove_history_for_alert_persists_updated_state(
    storage_factory,
):
    storage = storage_factory()
    storage._history = [
        {
            "config": {"id": "removed"},
            "event": {"type": "notification_sent"},
        },
        {"config": {"id": "kept"}, "event": {"type": "notification_sent"}},
    ]
    storage._history_loaded = True

    await storage.remove_history_for_alert("removed")

    assert storage.history == [
        {"config": {"id": "kept"}, "event": {"type": "notification_sent"}}
    ]
    await storage.save_history()
