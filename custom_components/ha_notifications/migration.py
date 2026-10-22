"""Config-entry migrations for HA Notifications."""

from __future__ import annotations

import logging
from copy import deepcopy
from pathlib import Path
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.start import async_at_started
from homeassistant.util.file import write_utf8_file_atomic
from homeassistant.util.yaml import dump, load_yaml

from .automation import GENERATED_DESCRIPTION
from .const import CONFIG_ENTRY_MINOR_VERSION, CONFIG_ENTRY_VERSION

_LOGGER = logging.getLogger(__name__)
_SUPPORTED_OLD_ENTRY_VERSIONS = {1, 2, 3, 4, 5}
_RETIRED_AUTOMATION_FILE = "ha_notifications_automations.yaml"
_RETIRED_INCLUDE = f"automation ha_notifications: !include {_RETIRED_AUTOMATION_FILE}"
_STANDARD_AUTOMATION_FILE = "automations.yaml"


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


def retire_automation_file(config_dir: Path) -> bool:
    """Remove the dedicated automation file and its include, keeping its automations.

    Releases before entry version 5 wrote generated automations to a dedicated
    file and added its include to ``configuration.yaml``. The include and file
    are removed first; generated automations are then added to HA's standard
    store unless their IDs are already there. Returns whether automations need
    to be reloaded.
    """
    retired = config_dir / _RETIRED_AUTOMATION_FILE
    standard = config_dir / _STANDARD_AUTOMATION_FILE
    configuration = config_dir / "configuration.yaml"

    generated = load_yaml(retired) if retired.is_file() else []
    if not isinstance(generated, list):
        raise HomeAssistantError(f"{_RETIRED_AUTOMATION_FILE} must contain a list.")
    generated = [
        item
        for item in generated
        if isinstance(item, dict) and item.get("description") == GENERATED_DESCRIPTION
    ]
    changed = retired.is_file()

    if configuration.is_file():
        lines = configuration.read_text().splitlines(keepends=True)
        kept = [line for line in lines if line.strip() != _RETIRED_INCLUDE]
        if kept != lines:
            write_utf8_file_atomic(str(configuration), "".join(kept))
            changed = True
        if changed and _STANDARD_AUTOMATION_FILE not in "".join(kept):
            _LOGGER.warning(
                "configuration.yaml does not include %s; add "
                "'automation: !include %s' so HA Notifications automations load",
                _STANDARD_AUTOMATION_FILE,
                _STANDARD_AUTOMATION_FILE,
            )
    retired.unlink(missing_ok=True)

    if generated:
        current = (load_yaml(standard) or []) if standard.is_file() else []
        if not isinstance(current, list):
            raise HomeAssistantError(f"{_STANDARD_AUTOMATION_FILE} must contain a list.")
        existing = {item.get("id") for item in current if isinstance(item, dict)}
        additions = [item for item in generated if item.get("id") not in existing]
        if additions:
            write_utf8_file_atomic(str(standard), dump([*current, *additions]))
    return changed


async def _async_reload_automations(hass: HomeAssistant) -> None:
    if hass.services.has_service("automation", "reload"):
        await hass.services.async_call("automation", "reload", blocking=True)


async def async_migrate_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Migrate supported older config-entry versions.

    Before version 5, new entries stored alerts in ``data`` until the first save
    wrote ``options``; version 5 keeps alerts only in ``options``. Version 6 also
    retires the dedicated automation file and reloads automations once.
    """
    if entry.version == CONFIG_ENTRY_VERSION:
        return True
    if entry.version not in _SUPPORTED_OLD_ENTRY_VERSIONS:
        return False

    try:
        moved = await hass.async_add_executor_job(
            retire_automation_file, Path(hass.config.config_dir)
        )
    except (HomeAssistantError, OSError) as err:
        _LOGGER.warning(
            "Could not retire %s automatically (%s); see the upgrade steps in "
            "docs/automation-flow.md",
            _RETIRED_AUTOMATION_FILE,
            err,
        )
        moved = False

    hass.config_entries.async_update_entry(
        entry,
        data={},
        options=migrate_config(dict(entry.options or entry.data)),
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        version=CONFIG_ENTRY_VERSION,
    )
    if moved:
        async_at_started(hass, _async_reload_automations)
    return True
