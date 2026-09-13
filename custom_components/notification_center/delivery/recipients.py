"""Recipient registry lookup for notification delivery."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .mobile_app import mobile_app_entry_ids
from .types import (
    NotificationRegistrySnapshot,
    NotificationTargetResolution,
)

GENERIC_NOTIFY_TARGET_KEYS = (
    "device_id",
    "area_id",
    "floor_id",
    "label_id",
    "entity_id",
)


def notification_registry_snapshot(
    hass: HomeAssistant,
) -> NotificationRegistrySnapshot:
    """Collect Home Assistant registries once for one delivery operation."""

    mobile_app_entries = hass.config_entries.async_entries("mobile_app")
    return NotificationRegistrySnapshot(
        hass,
        ar.async_get(hass),
        dr.async_get(hass),
        er.async_get(hass),
        mobile_app_entries,
        mobile_app_entry_ids(mobile_app_entries),
    )


def target_values(target: dict[str, Any], key: str) -> list[str]:
    """Return a target field as a non-empty list of strings."""

    values = target.get(key, [])
    if not isinstance(values, list):
        values = [values]
    return [str(value) for value in values if value]


def resolve_user_notification_target(
    registries: NotificationRegistrySnapshot,
    target: Any,
) -> tuple[dict[str, Any], bool]:
    """Expand user recipients into notify entities when possible."""

    if not isinstance(target, dict):
        return {}, False

    resolved_target = {
        key: deepcopy(target[key])
        for key in GENERIC_NOTIFY_TARGET_KEYS
        if key in target
    }
    user_ids = target_values(target, "user_id")
    if not user_ids:
        return resolved_target, False

    entry_user_ids = {
        entry.entry_id: str(entry.data.get("user_id"))
        for entry in registries.mobile_app_entries
        if isinstance(getattr(entry, "data", None), dict) and entry.data.get("user_id")
    }
    entities_by_user = {user_id: [] for user_id in user_ids}
    device_ids_by_user = _user_device_ids(registries, user_ids)

    for entity in registries.entity_registry.entities.values():
        if not entity.entity_id.startswith("notify."):
            continue

        mobile_app_user_id = entry_user_ids.get(
            getattr(entity, "config_entry_id", None)
        )
        for user_id in user_ids:
            if (
                mobile_app_user_id == user_id
                or getattr(entity, "device_id", None) in device_ids_by_user[user_id]
            ):
                entities_by_user[user_id].append(entity.entity_id)

    missing_user_ids = [
        user_id for user_id in user_ids if not entities_by_user[user_id]
    ]
    if missing_user_ids:
        raise ValueError(
            "Selected user has no notification-capable device: "
            + ", ".join(missing_user_ids)
        )

    entity_ids = target_values(resolved_target, "entity_id")
    for user_id in user_ids:
        for entity_id in entities_by_user[user_id]:
            if entity_id not in entity_ids:
                entity_ids.append(entity_id)
    resolved_target["entity_id"] = entity_ids

    return resolved_target, True


def resolve_target_devices(
    target: Any,
    area_registry: Any,
    device_registry: Any,
) -> NotificationTargetResolution:
    """Expand device targets selected directly or through area, floor, and label."""

    if not isinstance(target, dict):
        return NotificationTargetResolution(set(), set(), set())

    device_ids = set(target_values(target, "device_id"))
    area_ids = set(target_values(target, "area_id"))
    floor_ids = set(target_values(target, "floor_id"))
    label_ids = set(target_values(target, "label_id"))

    area_ids.update(
        area.area_id
        for area in area_registry.areas.values()
        if area.floor_id in floor_ids
    )

    for device in device_registry.devices.values():
        if device.area_id in area_ids or label_ids.intersection(
            getattr(device, "labels", set())
        ):
            device_ids.add(device.id)

    config_entry_ids = {
        entry_id
        for device in device_registry.devices.values()
        if device.id in device_ids
        for entry_id in getattr(device, "config_entries", set())
    }

    return NotificationTargetResolution(device_ids, area_ids, config_entry_ids)


def notification_services_for_target(
    registries: NotificationRegistrySnapshot,
    target: Any,
    resolution: NotificationTargetResolution | None = None,
) -> list[str]:
    """Return notify entities matching a rendered target."""

    if not isinstance(target, dict):
        return []

    resolution = resolution or resolve_target_devices(
        target,
        registries.area_registry,
        registries.device_registry,
    )
    return _notification_entities_for_target(
        target,
        registries.entity_registry,
        resolution,
    )


def _user_device_ids(
    registries: NotificationRegistrySnapshot,
    user_ids: list[str],
) -> dict[str, set[str]]:
    devices_by_user = {user_id: set() for user_id in user_ids}
    states = getattr(registries.hass, "states", None)
    if states is None:
        return devices_by_user

    for person in states.async_all("person"):
        user_id = str(person.attributes.get("user_id") or "")
        if user_id not in devices_by_user:
            continue

        trackers = person.attributes.get("device_trackers", [])
        if isinstance(trackers, str):
            trackers = [trackers]
        if not isinstance(trackers, list):
            continue

        for tracker in trackers:
            entry = registries.entity_registry.entities.get(str(tracker))
            device_id = getattr(entry, "device_id", None)
            if device_id:
                devices_by_user[user_id].add(str(device_id))

    return devices_by_user


def _notification_entities_for_target(
    target: dict[str, Any],
    entity_registry: Any,
    resolution: NotificationTargetResolution,
) -> list[str]:
    entity_ids = target_values(target, "entity_id")
    label_ids = set(target_values(target, "label_id"))
    services = []

    for entity in entity_registry.entities.values():
        if (
            entity.entity_id.startswith("notify.")
            and (
                entity.entity_id in entity_ids
                or entity.device_id in resolution.device_ids
                or getattr(entity, "config_entry_id", None)
                in resolution.config_entry_ids
                or entity.area_id in resolution.area_ids
                or label_ids.intersection(getattr(entity, "labels", set()))
            )
            and entity.entity_id not in services
        ):
            services.append(entity.entity_id)

    return services

