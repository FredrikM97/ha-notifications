"""Tests for the Home Assistant config flow."""

from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from homeassistant.config_entries import SOURCE_USER
from pytest_homeassistant.common import MockConfigEntry

from custom_components import ha_notifications
from custom_components.ha_notifications.config_flow import HaNotificationsConfigFlow
from custom_components.ha_notifications.const import (
    CONFIG_ENTRY_MINOR_VERSION,
    CONFIG_ENTRY_VERSION,
    DOMAIN,
)


def test_entry_has_no_options_flow_that_could_overwrite_alerts() -> None:
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        options={"version": 1, "alerts": []},
    )

    assert not HaNotificationsConfigFlow.async_supports_options_flow(entry)


@pytest.mark.asyncio
async def test_user_flow_does_not_modify_configuration_yaml(
    hass, monkeypatch, mock_notification_dependencies, snapshot
) -> None:
    configuration_path = Path(hass.config.path("configuration.yaml"))
    configuration_path.write_text("logger:\n  default: warning\n")
    original = configuration_path.read_text()
    setup_entry = AsyncMock(return_value=True)
    monkeypatch.setattr(ha_notifications, "async_setup_entry", setup_entry)

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert {
        **{key: value for key, value in result.items() if key not in {"flow_id", "data_schema"}},
        "data_schema": result["data_schema"].schema,
    } == snapshot(name="form")
    assert not hass.config_entries.async_entries(DOMAIN)

    created = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()
    assert {
        key: value for key, value in created.items() if key not in {"flow_id", "result"}
    } == snapshot(name="created")
    entry = created["result"]
    assert hass.config_entries.async_get_entry(entry.entry_id) is entry
    assert entry.version == CONFIG_ENTRY_VERSION
    assert entry.minor_version == CONFIG_ENTRY_MINOR_VERSION
    setup_entry.assert_awaited_once_with(hass, entry)
    assert configuration_path.read_text() == original


async def test_user_flow_rejects_a_second_config_entry(hass, snapshot) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
    )
    entry.add_to_hass(hass)

    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})

    assert {key: value for key, value in result.items() if key != "flow_id"} == snapshot
    assert hass.config_entries.async_entries(DOMAIN) == [entry]
