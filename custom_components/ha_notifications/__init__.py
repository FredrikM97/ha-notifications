"""HA Notifications integration."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from pydantic import ValidationError

from .automation import async_reconcile_automations
from .bridge import async_register_panel
from .configuration import validate_config
from .const import DOMAIN
from .domain import AutomationRunTracker, RuntimeData
from .history import HistoryStore
from .notification import async_setup_services, async_unload_services

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


def _affected_alert_ids(
    previous: dict[str, Any],
    current: dict[str, Any],
) -> set[str]:
    """Return alert IDs whose canonical configuration changed."""
    previous_alerts = {alert["id"]: alert for alert in previous["alerts"]}
    current_alerts = {alert["id"]: alert for alert in current["alerts"]}
    return {
        alert_id
        for alert_id in previous_alerts.keys() | current_alerts.keys()
        if previous_alerts.get(alert_id) != current_alerts.get(alert_id)
    }


async def _async_update_listener(hass: HomeAssistant, entry: Any) -> None:
    """Reconcile persisted options whenever Home Assistant updates the entry."""
    previous = (
        entry.runtime_data.config
        if isinstance(entry.runtime_data, RuntimeData)
        else validate_config(dict(entry.data))
    )
    validated = validate_config(dict(entry.options or entry.data))
    try:
        if not isinstance(entry.runtime_data, RuntimeData):
            entry.runtime_data = RuntimeData(config=validated)
        else:
            entry.runtime_data.config = validated
        await async_setup_services(hass)
        entry.runtime_data.automations = await async_reconcile_automations(
            hass,
            validated["alerts"],
        )
    except Exception:
        if isinstance(entry.runtime_data, RuntimeData):
            entry.runtime_data.config = previous
        raise


async def async_setup(
    hass: HomeAssistant,
    config: dict[str, Any],
) -> bool:
    """Set up HA Notifications."""
    from .bridge.websocket import register

    register(hass)
    await async_register_panel(hass)
    integration_config = config.get(DOMAIN)

    if integration_config is None:
        return True

    validated = validate_config(integration_config)

    await async_setup_services(hass)
    await async_reconcile_automations(hass, validated["alerts"])

    return True


async def async_setup_entry(hass: HomeAssistant, entry: Any) -> bool:
    """Set up HA Notifications from a config entry."""
    from .bridge.websocket import register

    register(hass)
    await async_register_panel(hass)
    config = dict(entry.options or entry.data)
    try:
        validated = validate_config(config)
    except ValidationError:
        return True
    history = HistoryStore(hass)
    await history.async_load()
    entry.runtime_data = RuntimeData(
        config=validated,
        history=history,
        automation_runs=AutomationRunTracker.create(),
        remove_update_listener=entry.add_update_listener(_async_update_listener),
    )
    await async_setup_services(hass)
    entry.runtime_data.automations = await async_reconcile_automations(
        hass,
        validated["alerts"],
    )
    return True


async def async_save_config(
    hass: HomeAssistant,
    entry: Any,
    config: dict[str, Any],
) -> dict[str, Any]:
    """Validate and persist a config-entry document atomically."""
    raw_previous = dict(entry.options or entry.data)
    try:
        previous = validate_config(raw_previous)
    except ValidationError:
        previous = raw_previous
    validated = validate_config(config)
    hass.config_entries.async_update_entry(entry, options=validated)
    if not isinstance(entry.runtime_data, RuntimeData):
        if hasattr(entry, "add_update_listener"):
            history = HistoryStore(hass)
            await history.async_load()
            entry.runtime_data = RuntimeData(
                config=validated,
                automation_runs=AutomationRunTracker.create(),
                history=history,
                remove_update_listener=entry.add_update_listener(
                    _async_update_listener
                ),
            )
            await async_setup_services(hass)
        else:
            entry.runtime_data = RuntimeData(
                config=validated,
                automation_runs=AutomationRunTracker.create(),
            )
    else:
        entry.runtime_data.config = validated
    try:
        automations = await async_reconcile_automations(hass, validated["alerts"])
        if isinstance(entry.runtime_data, RuntimeData):
            entry.runtime_data.automations = automations
    except Exception:
        hass.config_entries.async_update_entry(entry, options=previous)
        if isinstance(entry.runtime_data, RuntimeData):
            entry.runtime_data.config = previous
        raise
    return validated


async def async_unload_entry(hass: HomeAssistant, entry: Any) -> bool:
    """Unload a HA Notifications config entry."""
    runtime_data = getattr(entry, "runtime_data", None)
    if isinstance(runtime_data, RuntimeData):
        if runtime_data.remove_update_listener is not None:
            runtime_data.remove_update_listener()
        await async_reconcile_automations(hass, [])
        await async_unload_services(hass)
    entry.runtime_data = None
    return True
