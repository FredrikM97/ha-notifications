"""Tests for HA Notifications config-entry migrations."""

from __future__ import annotations

from copy import deepcopy

import pytest
from homeassistant.core import HomeAssistant

from custom_components import ha_notifications
from custom_components.ha_notifications.configuration import validate_config
from custom_components.ha_notifications.const import CONFIG_ENTRY_VERSION, DOMAIN
from tests.backend.conftest import MockConfigEntry


@pytest.mark.asyncio
async def test_migrate_entry_removes_retired_mode_from_data_and_options(
    hass: HomeAssistant,
) -> None:
    legacy_alert = {
        "id": "low_water",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {
                "enabled": True,
                "items": [{
                    "trigger": "state",
                    "entity_id": "sensor.water",
                    "to": "low",
                }],
            },
            "conditions": {"enabled": True, "items": []},
        },
        "notification": {
            "target": {"label_id": ["phone"]},
            "options": {"persistent": True, "sticky": True},
        },
        "confirmation": {"enabled": True},
    }
    data = {"version": 1, "alerts": [legacy_alert]}
    options = {"version": 1, "alerts": [{**legacy_alert, "id": "option_alert"}]}
    original_data = deepcopy(data)
    original_options = deepcopy(options)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data=data,
        options=options,
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_migrate_entry(hass, entry)

    assert entry.version == CONFIG_ENTRY_VERSION
    assert entry.data["version"] == 1
    assert entry.options["version"] == 1
    assert all("automation_mode" not in alert["monitor"] for alert in entry.data["alerts"])
    assert all("automation_mode" not in alert["monitor"] for alert in entry.options["alerts"])
    assert entry.data["alerts"][0]["monitor"]["triggers"] == original_data["alerts"][0]["monitor"]["triggers"]
    assert entry.options["alerts"][0]["notification"] == original_options["alerts"][0]["notification"]
    assert data == original_data
    assert options == original_options
    migrated_data = validate_config(dict(entry.data))
    migrated_options = validate_config(dict(entry.options))
    assert migrated_data["alerts"][0]["notification"]["target"] == {
        "label_id": ["phone"],
    }
    assert migrated_options["alerts"][0]["monitor"]["triggers"] == original_options["alerts"][0]["monitor"]["triggers"]