"""Tests for HA Notifications config-entry migrations."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("legacy_file_exists", "legacy_include_exists"),
    [(True, False), (False, True), (True, True)],
    ids=["old-file", "include", "both"],
)
async def test_migrate_entry_warns_about_legacy_automation_files(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
    legacy_file_exists: bool,
    legacy_include_exists: bool,
) -> None:
    legacy_file = Path(hass.config.path("ha_notifications_automations.yaml"))
    configuration_file = Path(hass.config.path("configuration.yaml"))
    legacy_contents = "- id: legacy\n"
    configuration_contents = (
        "automation ha_notifications: !include ha_notifications_automations.yaml\n"
        if legacy_include_exists
        else "automation: !include automations.yaml\n"
    )
    if legacy_file_exists:
        legacy_file.write_text(legacy_contents, encoding="utf-8")
    configuration_file.write_text(configuration_contents, encoding="utf-8")
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": []},
        version=3,
    )
    entry.add_to_hass(hass)
    caplog.set_level("WARNING", logger="custom_components.ha_notifications.migration")

    assert await ha_notifications.async_migrate_entry(hass, entry)

    warnings = [
        record.message
        for record in caplog.records
        if record.name == "custom_components.ha_notifications.migration"
    ]
    assert len(warnings) == 1
    assert "remove the `automation ha_notifications: !include" in warnings[0]
    assert "delete `ha_notifications_automations.yaml`" in warnings[0]
    assert "Reload in the YAML editor" in warnings[0]
    assert "through the API" in warnings[0]
    assert configuration_file.read_text(encoding="utf-8") == configuration_contents
    assert legacy_file.exists() is legacy_file_exists
    if legacy_file_exists:
        assert legacy_file.read_text(encoding="utf-8") == legacy_contents


@pytest.mark.asyncio
async def test_migrate_entry_does_not_warn_without_legacy_automation_files(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
) -> None:
    Path(hass.config.path("configuration.yaml")).write_text(
        "automation: !include automations.yaml\n",
        encoding="utf-8",
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": []},
        version=3,
    )
    entry.add_to_hass(hass)
    caplog.set_level("WARNING", logger="custom_components.ha_notifications.migration")

    assert await ha_notifications.async_migrate_entry(hass, entry)

    assert not [
        record
        for record in caplog.records
        if record.name == "custom_components.ha_notifications.migration"
    ]
