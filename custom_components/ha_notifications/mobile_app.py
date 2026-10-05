"""Resolve Mobile App notification services for selected targets."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .targets import TargetResolution, resolve_target, target_values


def _matching_entries(
    hass: HomeAssistant,
    resolution: TargetResolution,
) -> tuple[list[ConfigEntry], dict[str, list[str]], bool]:
    """Match Companion entries using the notification delivery target rules."""
    mobile_entries = hass.config_entries.async_entries("mobile_app")
    mobile_entry_ids = {entry.entry_id for entry in mobile_entries}
    matched_entry_ids: set[str] = set()
    names_by_entry_id: dict[str, list[str]] = {}
    entity_registry = er.async_get(hass)
    device_registry = dr.async_get(hass)
    device_ids = set(resolution.device_ids)
    unknown = not (resolution.entity_ids or device_ids)

    for entity_id in resolution.entity_ids:
        entity = entity_registry.entities.get(entity_id)
        if entity is None:
            unknown = True
            continue
        if entity.config_entry_id in mobile_entry_ids:
            matched_entry_ids.add(entity.config_entry_id)
        elif not entity.device_id:
            unknown = True
        if entity.device_id:
            device_ids.add(entity.device_id)

    for device_id in device_ids:
        device = device_registry.async_get(device_id)
        if device is None:
            entry_ids = set()
        else:
            entry_ids = {device.config_entry_id}.intersection(mobile_entry_ids)
        entry_ids.update(
            entry.entry_id
            for entry in mobile_entries
            if str(entry.data.get("device_id")) == device_id
        )
        if not entry_ids:
            unknown = True
        for entry_id in entry_ids:
            matched_entry_ids.add(entry_id)
            for name in (device.name_by_user, device.name) if device else ():
                if name:
                    names_by_entry_id.setdefault(entry_id, []).append(name)

    for entry in mobile_entries:
        entry_data = entry.data if isinstance(entry.data, Mapping) else {}
        if str(entry_data.get("device_id")) in device_ids:
            matched_entry_ids.add(entry.entry_id)
        if entry.entry_id in matched_entry_ids:
            for name in (entry.title, entry_data.get("device_name")):
                if name:
                    names_by_entry_id.setdefault(entry.entry_id, []).append(str(name))

    return (
        [entry for entry in mobile_entries if entry.entry_id in matched_entry_ids],
        names_by_entry_id,
        unknown,
    )


def resolve_platforms(hass: HomeAssistant, target: dict[str, Any]) -> dict[str, Any]:
    """Project runtime Companion OS metadata without exposing registration data."""
    platforms: set[str] = set()
    selectors = {"entity_id", "device_id", "area_id", "floor_id", "label_id", "user_id"}
    unknown = bool(target.keys() - selectors)
    selected = False
    for selector in selectors:
        for value in target_values(target, selector):
            selected = True
            entries, _names, unresolved = _matching_entries(
                hass, resolve_target(hass, {selector: value})
            )
            unknown |= unresolved
            for entry in entries:
                os_name = entry.data.get("os_name")
                normalized = os_name.strip().lower() if isinstance(os_name, str) else ""
                if normalized == "android":
                    platforms.add("android")
                elif normalized in {"ios", "ipados", "macos"}:
                    platforms.add("ios")
                else:
                    unknown = True
    return {"platforms": sorted(platforms), "unknown": unknown or not selected}


def resolve_services(
    hass: HomeAssistant,
    resolution: TargetResolution,
) -> list[str]:
    """Return verified notify services for matching Mobile App entries."""
    _entries, names_by_entry_id, _unknown = _matching_entries(hass, resolution)
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
