"""Tests for HA Notifications config-entry migrations."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from threading import get_ident

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant.common import MockConfigEntry

from custom_components import ha_notifications
from custom_components.ha_notifications import migration
from custom_components.ha_notifications.configuration import validate_config
from custom_components.ha_notifications.const import (
    CONFIG_ENTRY_MINOR_VERSION,
    CONFIG_ENTRY_VERSION,
    DOMAIN,
)


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
    ("version", "data", "options"),
    [
        (
            1,
            {"version": 1, "alerts": [_legacy_alert("data_alert")]},
            {"version": 1, "alerts": [_legacy_alert("option_alert")]},
        ),
        (4, {"version": 1, "alerts": [_legacy_alert("never_saved")]}, {}),
        (5, {}, {"version": 1, "alerts": [_legacy_alert("current")]}),
        (3, {}, {"version": 1, "alerts": []}),
    ],
    ids=["saved-options-win", "unsaved-data-moves", "options-only", "previous-minor-version"],
)
async def test_migrate_entry_keeps_alerts_only_in_options(
    hass: HomeAssistant,
    version: int,
    data: dict,
    options: dict,
    snapshot,
) -> None:
    originals = deepcopy((data, options))
    entry = MockConfigEntry(
        minor_version=1 if version == 3 else CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        data=data,
        options=options,
        version=version,
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_migrate_entry(hass, entry)

    assert {
        "version": entry.version,
        "minor_version": entry.minor_version,
        "data": dict(entry.data),
        "options": dict(entry.options),
    } == snapshot
    validate_config(dict(entry.options))
    assert (data, options) == originals


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
    snapshot,
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
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
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
    assert warnings == snapshot
    assert configuration_file.read_text(encoding="utf-8") == configuration_contents
    assert legacy_file.exists() is legacy_file_exists
    if legacy_file_exists:
        assert legacy_file.read_text(encoding="utf-8") == legacy_contents


@pytest.mark.asyncio
@pytest.mark.parametrize("configuration_file_exists", [False, True])
async def test_migrate_entry_does_not_warn_without_legacy_automation_files(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
    configuration_file_exists: bool,
) -> None:
    if configuration_file_exists:
        Path(hass.config.path("configuration.yaml")).write_text(
            "automation: !include automations.yaml\n",
            encoding="utf-8",
        )
    entry = MockConfigEntry(
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
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


@pytest.mark.asyncio
async def test_migrate_entry_checks_legacy_files_in_executor(
    hass: HomeAssistant,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    event_loop_thread = get_ident()
    checked_paths: list[tuple[Path, Path]] = []
    detect_legacy_configuration = migration._has_legacy_automation_configuration

    def check_legacy_configuration(legacy_file: Path, configuration_file: Path) -> bool:
        assert get_ident() != event_loop_thread
        checked_paths.append((legacy_file, configuration_file))
        return detect_legacy_configuration(legacy_file, configuration_file)

    monkeypatch.setattr(
        migration, "_has_legacy_automation_configuration", check_legacy_configuration
    )
    legacy_file = Path(hass.config.path("ha_notifications_automations.yaml"))
    configuration_file = Path(hass.config.path("configuration.yaml"))
    configuration_file.write_text("automation: !include automations.yaml\n", encoding="utf-8")
    entry = MockConfigEntry(
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        options={"version": 1, "alerts": []},
        version=3,
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_migrate_entry(hass, entry)

    assert checked_paths == [(legacy_file, configuration_file)]
    assert entry.version == CONFIG_ENTRY_VERSION
