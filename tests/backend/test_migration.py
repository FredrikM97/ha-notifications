"""Tests for HA Notifications config-entry migrations."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest
import yaml
from homeassistant.core import HomeAssistant, callback
from homeassistant.setup import async_setup_component

from custom_components import ha_notifications
from custom_components.ha_notifications.automation import GENERATED_DESCRIPTION
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
async def test_migrate_previous_entry_version(
    hass: HomeAssistant,
) -> None:
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


def _automation(automation_id: str, description: str = GENERATED_DESCRIPTION) -> dict:
    return {
        "id": automation_id,
        "alias": automation_id,
        "description": description,
        "triggers": [],
        "actions": [],
    }


async def _migrate_v5(hass: HomeAssistant) -> list[dict]:
    reloads: list[dict] = []

    @callback
    def record_reload(event) -> None:
        if event.data["domain"] == "automation" and event.data["service"] == "reload":
            reloads.append(event.data["service_data"])

    hass.bus.async_listen("call_service", record_reload)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": []},
        version=5,
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_migrate_entry(hass, entry)
    await hass.async_block_till_done()
    assert entry.version == CONFIG_ENTRY_VERSION
    return reloads


@pytest.mark.asyncio
async def test_migration_retires_dedicated_automation_file_and_reloads_once(
    hass: HomeAssistant,
) -> None:
    config_dir = Path(hass.config.config_dir)
    configuration = config_dir / "configuration.yaml"
    configuration.write_text(
        "default_config:\n"
        "automation: !include automations.yaml\n"
        "automation ha_notifications: !include ha_notifications_automations.yaml\n"
        "logger:\n"
    )
    user = _automation("user_owned", "Mine")
    already_saved = _automation("ha_notifications_saved")
    (config_dir / "automations.yaml").write_text(yaml.safe_dump([user, already_saved]))
    stale_duplicate = {**_automation("ha_notifications_saved"), "alias": "stale"}
    retired = config_dir / "ha_notifications_automations.yaml"
    retired.write_text(
        yaml.safe_dump(
            [stale_duplicate, _automation("ha_notifications_moved"), _automation("foreign", "x")]
        )
    )
    assert await async_setup_component(hass, "automation", {"automation": []})

    reloads = await _migrate_v5(hass)

    assert not retired.exists()
    assert configuration.read_text() == (
        "default_config:\nautomation: !include automations.yaml\nlogger:\n"
    )
    assert yaml.safe_load((config_dir / "automations.yaml").read_text()) == [
        user,
        already_saved,
        _automation("ha_notifications_moved"),
    ]
    assert reloads == [{}]
    assert hass.states.get("automation.ha_notifications_moved") is not None
    assert hass.states.get("automation.stale") is None


@pytest.mark.asyncio
async def test_migration_without_dedicated_automation_file_changes_nothing(
    hass: HomeAssistant,
) -> None:
    configuration = Path(hass.config.config_dir) / "configuration.yaml"
    configuration.write_text("automation: !include automations.yaml\n")
    assert await async_setup_component(hass, "automation", {"automation": []})

    assert await _migrate_v5(hass) == []
    assert configuration.read_text() == "automation: !include automations.yaml\n"
    assert not (Path(hass.config.config_dir) / "automations.yaml").exists()


@pytest.mark.asyncio
async def test_migration_keeps_unreadable_dedicated_automation_file(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
) -> None:
    config_dir = Path(hass.config.config_dir)
    include = "automation ha_notifications: !include ha_notifications_automations.yaml\n"
    (config_dir / "configuration.yaml").write_text(include)
    retired = config_dir / "ha_notifications_automations.yaml"
    retired.write_text("not: a list\n")

    assert await _migrate_v5(hass) == []
    assert retired.read_text() == "not: a list\n"
    assert (config_dir / "configuration.yaml").read_text() == include
    assert "Could not retire ha_notifications_automations.yaml" in caplog.text
