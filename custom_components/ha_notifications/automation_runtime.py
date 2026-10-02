"""Reconcile generated automations with Home Assistant runtime state."""

from __future__ import annotations

import asyncio
import logging
import weakref
from pathlib import Path
from typing import Any

from homeassistant.components.automation import DATA_COMPONENT as AUTOMATION_DATA
from homeassistant.core import HomeAssistant
from homeassistant.helpers import category_registry as cr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import label_registry as lr

from .automation import GENERATED_DESCRIPTION, async_validate_alerts, automation_id
from .automation_storage import (
    automation_file_contents,
    read_file_bytes_if_exists,
    restore_file,
    write_automation_files,
)
from .const import (
    AUTOMATION_CATEGORY,
    AUTOMATION_CATEGORY_SCOPE,
    AUTOMATION_FILE,
    AUTOMATION_LABEL,
    DOMAIN,
)

_RECONCILIATION_LOCKS: weakref.WeakKeyDictionary[HomeAssistant, asyncio.Lock] = weakref.WeakKeyDictionary()
_RECONCILIATION_FALLBACK_LOCKS: dict[int, asyncio.Lock] = {}
_LOGGER = logging.getLogger(__name__)


def _reconciliation_lock(hass: HomeAssistant) -> asyncio.Lock:
    """Return the reconciliation lock for a Home Assistant instance."""
    try:
        return _RECONCILIATION_LOCKS.setdefault(hass, asyncio.Lock())
    except TypeError:
        return _RECONCILIATION_FALLBACK_LOCKS.setdefault(id(hass), asyncio.Lock())


async def _async_record_reloaded_run_cancellations(hass: HomeAssistant) -> None:
    """Close history for runs stopped by reloading Home Assistant automations."""
    config_entries = getattr(hass, "config_entries", None)
    async_entries = getattr(config_entries, "async_entries", None)
    if not callable(async_entries):
        return
    active_statuses = {"started", "waiting", "running"}
    terminal_statuses = {
        "cancelled",
        "completed",
        "inactive",
        "confirmation_completed",
        "confirmation_timeout",
    }
    for entry in async_entries(DOMAIN):
        runtime_data = getattr(entry, "runtime_data", None)
        history = getattr(runtime_data, "history", None)
        if history is None:
            continue
        entries = await history.async_entries()
        latest: dict[tuple[str, str], tuple[bool, str]] = {}
        for history_entry in entries:
            config = history_entry.get("config")
            event = history_entry.get("event")
            if not isinstance(config, dict) or not isinstance(event, dict):
                continue
            alert_id = config.get("id")
            flow_id = event.get("flow_id")
            event_type = event.get("type")
            if (
                not isinstance(alert_id, str)
                or not isinstance(flow_id, str)
                or not flow_id
                or event_type not in active_statuses | terminal_statuses
            ):
                continue
            key = (alert_id, flow_id)
            if key not in latest:
                latest[key] = (
                    event_type in active_statuses,
                    str(config.get("name", alert_id)),
                )
        for (alert_id, flow_id), (active, alert_name) in latest.items():
            if not active:
                continue
            await history.async_record(
                alert_id,
                alert_name,
                "cancelled",
                "Automation run stopped because automations were reloaded",
                {"action": "automation_reloaded"},
                flow_id=flow_id,
            )


def ensure_automation_include(path: Path) -> bool:
    """Ensure the dedicated generated automation include is configured."""
    include_line = f"automation ha_notifications: !include {AUTOMATION_FILE}\n"
    content = path.read_text() if path.exists() else ""
    if include_line.rstrip("\n") in content.splitlines():
        return False
    separator = "" if not content or content.endswith("\n") else "\n"
    path.write_text(f"{content}{separator}{include_line}")
    return True


def automation_status(
    document: list[dict[str, Any]],
    alert: dict[str, Any],
) -> str:
    """Return the ownership/status projection for one generated automation."""
    if alert.get("automation", {}).get("ownership") == "manual":
        return "manual"

    generated = next(
        (item for item in document if item.get("id") == automation_id(alert)),
        None,
    )
    if generated is None:
        return "missing"
    if generated.get("description") != GENERATED_DESCRIPTION:
        return "conflict"
    if generated.get("initial_state") is False:
        return "disabled"
    return "managed"


async def async_reconcile_automations(
    hass: HomeAssistant,
    alerts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Reconcile managed automations and reload Home Assistant's collection."""
    lock = _reconciliation_lock(hass)
    async with lock:
        path = Path(hass.config.path(AUTOMATION_FILE))
        configuration_path = Path(hass.config.path("configuration.yaml"))
        await hass.async_add_executor_job(
            ensure_automation_include,
            configuration_path,
        )
        document = await async_validate_alerts(hass, alerts)
        original = await hass.async_add_executor_job(read_file_bytes_if_exists, path)
        try:
            if original == automation_file_contents(document):
                _LOGGER.debug("Generated automations are unchanged; skipping reload")
            else:
                await hass.async_add_executor_job(write_automation_files, path, document)
                await hass.services.async_call("automation", "reload", blocking=True)
                await _async_record_reloaded_run_cancellations(hass)
                _LOGGER.info(
                    "Reloaded %d generated automation(s)",
                    len(document),
                )
            _organize_generated_automations(hass, document)
        except Exception:
            await hass.async_add_executor_job(restore_file, path, original)
            raise
        return document


def _organize_generated_automations(
    hass: HomeAssistant,
    document: list[dict[str, Any]],
) -> None:
    """Assign the managed label and category to generated automations."""
    component = getattr(hass, "data", {}).get(AUTOMATION_DATA)
    if component is None:
        return
    label_registry = lr.async_get(hass)
    label = label_registry.async_get_label_by_name(AUTOMATION_LABEL)
    if label is None:
        label = label_registry.async_create(
            AUTOMATION_LABEL,
            description="Automations generated by HA Notifications.",
        )
    category_registry = cr.async_get(hass)
    category = next(
        (
            item
            for item in category_registry.async_list_categories(
                scope=AUTOMATION_CATEGORY_SCOPE,
            )
            if item.name == AUTOMATION_CATEGORY
        ),
        None,
    )
    if category is None:
        category = category_registry.async_create(
            name=AUTOMATION_CATEGORY,
            scope=AUTOMATION_CATEGORY_SCOPE,
        )
    entity_registry = er.async_get(hass)
    generated_ids = {item["id"] for item in document}
    for entity in getattr(component, "entities", ()):
        if getattr(entity, "unique_id", None) not in generated_ids:
            continue
        registry_entry = entity_registry.async_get(entity.entity_id)
        if registry_entry is None:
            continue
        labels = set(registry_entry.labels) | {label.label_id}
        categories = {
            **registry_entry.categories,
            AUTOMATION_CATEGORY_SCOPE: category.category_id,
        }
        hidden_by = (
            registry_entry.hidden_by
            if registry_entry.hidden_by is not None
            else er.RegistryEntryHider.INTEGRATION
        )
        if (
            labels != registry_entry.labels
            or categories != registry_entry.categories
            or hidden_by != registry_entry.hidden_by
        ):
            entity_registry.async_update_entity(
                entity.entity_id,
                labels=labels,
                categories=categories,
                hidden_by=hidden_by,
            )