"""Config-entry migrations for HA Notifications."""

from __future__ import annotations

import logging
from copy import deepcopy
from pathlib import Path
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONFIG_ENTRY_MINOR_VERSION, CONFIG_ENTRY_VERSION

_LOGGER = logging.getLogger(__name__)
_SUPPORTED_OLD_ENTRY_VERSIONS = {1, 2, 3, 4, 5}
_LEGACY_AUTOMATION_FILE = "ha_notifications_automations.yaml"


def migrate_config(config: dict[str, Any]) -> dict[str, Any]:
    """Migrate retired configuration fields when upgrading an entry."""
    migrated = deepcopy(config)
    alerts = migrated.get("alerts")
    if not isinstance(alerts, list):
        return migrated
    for alert in alerts:
        if not isinstance(alert, dict):
            continue
        monitor = alert.get("monitor")
        if isinstance(monitor, dict):
            monitor.pop("automation_mode", None)
    return migrated


async def async_migrate_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Migrate supported older config-entry versions.

    Before version 5, new entries stored alerts in ``data`` until the first save
    wrote ``options``; version 5 keeps alerts only in ``options``. Legacy
    automation files are left untouched and reported for manual cleanup.
    """
    if entry.version == CONFIG_ENTRY_VERSION:
        return True
    if entry.version not in _SUPPORTED_OLD_ENTRY_VERSIONS:
        return False

    legacy_file = Path(hass.config.path(_LEGACY_AUTOMATION_FILE))
    configuration_file = Path(hass.config.path("configuration.yaml"))
    has_legacy_include = configuration_file.is_file() and any(
        "!include" in line and _LEGACY_AUTOMATION_FILE in line
        for line in configuration_file.read_text(encoding="utf-8").splitlines()
    )
    if legacy_file.exists() or has_legacy_include:
        _LOGGER.warning(
            "Legacy HA Notifications automation configuration detected. To finish "
            "upgrading, manually remove the `automation ha_notifications: !include "
            "%s` line from configuration.yaml and delete `%s`, then use Reload in "
            "the YAML editor so the automations are created through the API. "
            "No legacy files were changed.",
            _LEGACY_AUTOMATION_FILE,
            _LEGACY_AUTOMATION_FILE,
        )

    hass.config_entries.async_update_entry(
        entry,
        data={},
        options=migrate_config(dict(entry.options or entry.data)),
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        version=CONFIG_ENTRY_VERSION,
    )
    return True
