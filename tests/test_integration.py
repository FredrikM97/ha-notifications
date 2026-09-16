"""Home Assistant integration lifecycle tests."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant

from custom_components.ha_notifications.const import (
    DOMAIN,
    SERVICE_RELOAD,
    SERVICE_TEST,
)
from custom_components.ha_notifications.support.storage import ConfigEntryStorage


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_loaded_entry_registers_services(
    hass: HomeAssistant,
    loaded_config_entry,
) -> None:
    """A config entry loads the integration and exposes its public services."""
    assert loaded_config_entry.state.value == "loaded"
    assert hass.services.has_service(DOMAIN, SERVICE_RELOAD)
    assert hass.services.has_service(DOMAIN, SERVICE_TEST)

    assert await hass.config_entries.async_unload(loaded_config_entry.entry_id)
    await hass.async_block_till_done()
    assert hass.services.has_service(DOMAIN, SERVICE_RELOAD)
    assert hass.services.has_service(DOMAIN, SERVICE_TEST)

    await hass.config_entries.async_remove(loaded_config_entry.entry_id)
    await hass.async_block_till_done()
    assert not hass.services.has_service(DOMAIN, SERVICE_RELOAD)
    assert not hass.services.has_service(DOMAIN, SERVICE_TEST)


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_configuration_is_persisted_in_entry_options(
    hass: HomeAssistant,
    loaded_config_entry,
) -> None:
    """Structured alert configuration uses Home Assistant config-entry storage."""
    storage = ConfigEntryStorage(hass, loaded_config_entry)
    config = {
        "version": 1,
        "alerts": [{"id": "demo", "name": "Demo"}],
    }

    saved = await storage.save(config)
    assert saved["version"] == 1
    assert saved["alerts"][0]["id"] == "demo"
    assert loaded_config_entry.options == saved
    assert await ConfigEntryStorage(hass, loaded_config_entry).load() == saved


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_entry_option_updates_reload_live_configuration(
    hass: HomeAssistant,
    loaded_config_entry,
) -> None:
    """ConfigEntry option changes are applied by the controller listener."""
    storage = ConfigEntryStorage(hass, loaded_config_entry)
    await storage.save(
        {
            "version": 1,
            "alerts": [{"id": "demo", "name": "Demo"}],
        }
    )
    await hass.async_block_till_done()

    controller = loaded_config_entry.runtime_data
    assert await controller.dispatch("alerts.get", "demo") is not None