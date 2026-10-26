"""Config-entry migrations for HA Notifications."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONFIG_ENTRY_MINOR_VERSION, CONFIG_ENTRY_VERSION

_SUPPORTED_OLD_ENTRY_VERSIONS = {1, 2, 3, 4, 5}


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

    hass.config_entries.async_update_entry(
        entry,
        data={},
        options=migrate_config(dict(entry.options or entry.data)),
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        version=CONFIG_ENTRY_VERSION,
    )
    return True
