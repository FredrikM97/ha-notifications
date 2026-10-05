"""Resolve Home Assistant notification target selectors."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.device_registry import (
    async_entries_for_area,
    async_entries_for_label,
)
from homeassistant.helpers.target import (
    TargetSelection,
    async_extract_referenced_entity_ids,
)


@dataclass(frozen=True, slots=True)
class TargetResolution:
    """Entities and devices selected by a notification target."""

    entity_ids: set[str]
    device_ids: set[str]


def target_values(target: dict[str, Any], key: str) -> list[str]:
    """Return target values as normalized strings."""
    values = target.get(key, [])
    if not isinstance(values, list):
        values = [values]
    return [str(value) for value in values if value]


def resolve_target(hass: HomeAssistant, target: dict[str, Any]) -> TargetResolution:
    """Expand target selectors against current Home Assistant registries."""
    selected = async_extract_referenced_entity_ids(
        hass, TargetSelection(target), primary_entities_only=False
    )
    entity_ids = set(selected.referenced) | set(selected.indirectly_referenced)
    device_registry = dr.async_get(hass)
    entity_registry = er.async_get(hass)
    device_ids = _target_device_ids(hass, target)

    for entity_id in entity_ids:
        entity = entity_registry.entities.get(entity_id)
        if entity and entity.device_id:
            device_ids.add(entity.device_id)

    user_ids = set(target_values(target, "user_id"))
    if user_ids:
        for entity in entity_registry.entities.values():
            if not entity.entity_id.startswith("notify.") or not entity.device_id:
                continue
            device = device_registry.async_get(entity.device_id)
            if device and device.user_id in user_ids:
                entity_ids.add(entity.entity_id)

        for entry in hass.config_entries.async_entries("mobile_app"):
            entry_data = entry.data if isinstance(entry.data, Mapping) else {}
            if str(entry_data.get("user_id")) not in user_ids:
                continue
            entity_ids.update(
                entity.entity_id
                for entity in entity_registry.entities.values()
                if entity.config_entry_id == entry.entry_id
            )

        for state in hass.states.async_all("person"):
            if str(state.attributes.get("user_id")) not in user_ids:
                continue
            trackers = state.attributes.get("device_trackers", [])
            if isinstance(trackers, str):
                trackers = [trackers]
            for tracker in trackers if isinstance(trackers, list) else []:
                entity = entity_registry.entities.get(str(tracker))
                if entity and entity.device_id:
                    device_ids.add(entity.device_id)

    return TargetResolution(entity_ids, device_ids)


def _target_device_ids(hass: HomeAssistant, target: dict[str, Any]) -> set[str]:
    """Resolve device, area, floor, and label selectors to device IDs."""
    device_registry = dr.async_get(hass)
    area_registry = ar.async_get(hass)
    area_ids = set(target_values(target, "area_id"))
    floor_ids = set(target_values(target, "floor_id"))
    label_ids = set(target_values(target, "label_id"))
    area_ids.update(
        area.id
        for area in area_registry.areas.values()
        if area.floor_id in floor_ids
    )
    devices = [
        device
        for area_id in area_ids
        for device in async_entries_for_area(device_registry, area_id)
    ]
    for label_id in label_ids:
        devices.extend(async_entries_for_label(device_registry, label_id))
    return set(target_values(target, "device_id")) | {
        device.id for device in devices
    }
