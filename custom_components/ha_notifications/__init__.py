"""HA Notifications integration."""

from __future__ import annotations

from contextlib import suppress
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from pydantic import ValidationError

from .automation import async_validate_alerts
from .automation_runtime import (
    async_cancel_changed_automations,
    track_automation_metadata,
)
from .bridge import async_register_panel
from .configuration import empty_config, stored_config, validate_config
from .const import DOMAIN
from .domain import RuntimeData
from .history import HistoryStore
from .migration import async_migrate_entry as async_migrate_entry
from .notification import async_setup_services, async_unload_services

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def _async_apply_config(
    hass: HomeAssistant,
    entry: Any,
    validated: dict[str, Any],
) -> None:
    """Prepare generated automations and publish them with the validated config."""
    automations = await async_validate_alerts(hass, validated["alerts"])
    await async_cancel_changed_automations(hass, entry, automations)
    entry.runtime_data.config = validated
    entry.runtime_data.automations = automations


async def _async_update_listener(hass: HomeAssistant, entry: Any) -> None:
    """Apply entry updates that did not come through ``async_save_config``."""
    validated = validate_config(stored_config(entry))
    if entry.runtime_data.config != validated:
        await _async_apply_config(hass, entry, validated)


async def async_setup(
    hass: HomeAssistant,
    config: dict[str, Any],
) -> bool:
    """Set up HA Notifications."""
    from .bridge.websocket import register

    register(hass)
    await async_register_panel(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: Any) -> bool:
    """Set up HA Notifications from a config entry."""
    from .bridge.websocket import register

    register(hass)
    await async_register_panel(hass)
    history = HistoryStore(hass)
    await history.async_load()
    entry.runtime_data = RuntimeData(config=empty_config(), automations=[], history=history)
    # Keep the panel's YAML recovery editor available for invalid stored config.
    with suppress(ValidationError):
        await _async_apply_config(hass, entry, validate_config(stored_config(entry)))
    entry.runtime_data.remove_update_listener = entry.add_update_listener(_async_update_listener)
    entry.runtime_data.remove_automation_listener = track_automation_metadata(hass, entry)
    await async_setup_services(hass)
    return True


async def async_save_config(
    hass: HomeAssistant,
    entry: Any,
    config: dict[str, Any],
) -> dict[str, Any]:
    """Validate automations before persisting canonical configuration."""
    validated = validate_config(config)
    runtime = entry.runtime_data
    previous = (runtime.config, runtime.automations)
    await _async_apply_config(hass, entry, validated)
    # HA starts update listeners eagerly; publish the validated runtime first.
    try:
        hass.config_entries.async_update_entry(entry, options=validated)
    except Exception:
        runtime.config, runtime.automations = previous
        raise
    return validated


async def async_unload_entry(hass: HomeAssistant, entry: Any) -> bool:
    """Unload a HA Notifications config entry."""
    runtime_data = getattr(entry, "runtime_data", None)
    if isinstance(runtime_data, RuntimeData):
        if runtime_data.remove_update_listener is not None:
            runtime_data.remove_update_listener()
        if runtime_data.remove_automation_listener is not None:
            runtime_data.remove_automation_listener()
        await async_unload_services(hass)
    entry.runtime_data = None
    return True
