"""Tests for HA Notifications config-entry migrations."""

from __future__ import annotations

from copy import deepcopy

import pytest
from homeassistant.core import HomeAssistant

from custom_components import ha_notifications
from custom_components.ha_notifications.configuration import validate_config
from custom_components.ha_notifications.const import CONFIG_ENTRY_VERSION, DOMAIN
from tests.backend.conftest import MockConfigEntry


def _legacy_alert(alert_id: str) -> dict:
    return {
        "id": alert_id,
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {
                "enabled": True,
                "items": [
                    {
                        "trigger": "state",
                        "entity_id": "sensor.water",
                        "to": "low",
                    }
                ],
            },
            "conditions": {"enabled": True, "items": []},
        },
        "notification": {
            "target": {"label_id": ["phone"]},
            "options": {"persistent": True, "sticky": True},
        },
        "confirmation": {"enabled": True},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("version", "data", "options", "expected_id"),
    [
        (
            1,
            {"version": 1, "alerts": [_legacy_alert("data_alert")]},
            {"version": 1, "alerts": [_legacy_alert("option_alert")]},
            "option_alert",
        ),
        (4, {"version": 1, "alerts": [_legacy_alert("never_saved")]}, {}, "never_saved"),
        (5, {}, {"version": 1, "alerts": [_legacy_alert("current")]}, "current"),
    ],
    ids=["saved-options-win", "unsaved-data-moves", "options-only"],
)
async def test_migrate_entry_keeps_alerts_only_in_options(
    hass: HomeAssistant,
    version: int,
    data: dict,
    options: dict,
    expected_id: str,
) -> None:
    originals = deepcopy((data, options))
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data=data,
        options=options,
        version=version,
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_migrate_entry(hass, entry)

    assert entry.version == CONFIG_ENTRY_VERSION
    assert entry.minor_version == 0
    assert entry.data == {}
    assert (data, options) == originals
    migrated = validate_config(dict(entry.options))
    assert [alert["id"] for alert in migrated["alerts"]] == [expected_id]
    assert "automation_mode" not in entry.options["alerts"][0]["monitor"]
    assert migrated["alerts"][0]["notification"]["target"] == {"label_id": ["phone"]}


@pytest.mark.asyncio
async def test_migrate_previous_entry_version(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": []},
        version=3,
        minor_version=1,
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_migrate_entry(hass, entry)

    assert entry.version == CONFIG_ENTRY_VERSION
    assert entry.minor_version == 0
