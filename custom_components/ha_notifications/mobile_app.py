"""Resolve Mobile App notification services for selected targets."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .targets import TargetResolution


def resolve_services(
    hass: HomeAssistant,
    resolution: TargetResolution,
) -> list[str]:
    """Return verified notify services for matching Mobile App entries."""
    mobile_entries = hass.config_entries.async_entries("mobile_app")
    mobile_entry_ids = {entry.entry_id for entry in mobile_entries}
    matched_entry_ids: set[str] = set()
    names_by_entry_id: dict[str, list[str]] = {}
    entity_registry = er.async_get(hass)
    device_registry = dr.async_get(hass)
    device_ids = set(resolution.device_ids)

    for entity_id in resolution.entity_ids:
        entity = entity_registry.entities.get(entity_id)
        if entity is None:
            continue
        if entity.config_entry_id in mobile_entry_ids:
            matched_entry_ids.add(entity.config_entry_id)
        if entity.device_id:
            device_ids.add(entity.device_id)

    for device_id in device_ids:
        device = device_registry.async_get(device_id)
        if device is None:
            continue
        for entry_id in set(device.config_entries).intersection(mobile_entry_ids):
            matched_entry_ids.add(entry_id)
            for name in (device.name_by_user, device.name):
                if name:
                    names_by_entry_id.setdefault(entry_id, []).append(name)

    for entry in mobile_entries:
        entry_data = entry.data if isinstance(entry.data, dict) else {}
        if str(entry_data.get("device_id")) in device_ids:
            matched_entry_ids.add(entry.entry_id)
        if entry.entry_id in matched_entry_ids:
            for name in (entry.title, entry_data.get("device_name")):
                if name:
                    names_by_entry_id.setdefault(entry.entry_id, []).append(str(name))

    services: list[str] = []
    for names in names_by_entry_id.values():
        for name in names:
            service = (
                "mobile_app_"
                + str(name).lower().replace(" ", "_").replace("-", "_")
            )
            if service in services or not hass.services.has_service("notify", service):
                continue
            services.append(service)
    return [f"notify.{service}" for service in services]
