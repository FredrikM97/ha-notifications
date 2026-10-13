"""Config-entry migrations for HA Notifications."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONFIG_ENTRY_VERSION

_LEGACY_ENTRY_VERSION = 1


def migrate_config(config: dict[str, Any]) -> dict[str, Any]:
    """Remove configuration fields retired before the current entry version."""
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
    """Migrate version 1 entries by removing retired monitor automation mode."""
    if entry.version == CONFIG_ENTRY_VERSION:
        return True
    if entry.version != _LEGACY_ENTRY_VERSION:
        return False

    hass.config_entries.async_update_entry(
        entry,
        data=migrate_config(dict(entry.data)),
        options=migrate_config(dict(entry.options)),
        version=CONFIG_ENTRY_VERSION,
    )
    return True