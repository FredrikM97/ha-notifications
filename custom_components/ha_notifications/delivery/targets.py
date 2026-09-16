"""Target and registry resolution for notification delivery."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RegistrySnapshot:
    """Home Assistant registries/state needed to plan one delivery."""

    area_registry: Any
    device_registry: Any
    entity_registry: Any
    mobile_app_entries: list[Any]
    person_states: list[Any]
    has_service: Any = None

GENERIC_NOTIFY_TARGET_KEYS = (
    "device_id",
    "area_id",
    "floor_id",
    "label_id",
    "entity_id",
)
GENERIC_NOTIFY_SERVICE = "send_message"


@dataclass(frozen=True)
class TargetResolution:
    device_ids: set[str]
    area_ids: set[str]
    config_entry_ids: set[str]


def target_values(target: dict[str, Any], key: str) -> list[str]:
    values = target.get(key, [])
    if not isinstance(values, list):
        values = [values]
    return [str(value) for value in values if value]


def resolve_user_notification_target(
    registry_snapshot: RegistrySnapshot, notification_target: Any
) -> dict[str, Any]:
    if not isinstance(notification_target, dict):
        return {}

    resolved_target = {
        key: deepcopy(notification_target[key])
        for key in GENERIC_NOTIFY_TARGET_KEYS
        if key in notification_target
    }
    user_ids = target_values(notification_target, "user_id")
    if not user_ids:
        return resolved_target

    entry_user_ids = {
        entry.entry_id: str(entry.data.get("user_id"))
        for entry in registry_snapshot.mobile_app_entries
        if isinstance(getattr(entry, "data", None), dict) and entry.data.get("user_id")
    }
    entities_by_user: dict[str, list[str]] = {user_id: [] for user_id in user_ids}
    device_ids_by_user = _user_device_ids(registry_snapshot, user_ids)

    for entity in registry_snapshot.entity_registry.entities.values():
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

    entity_ids = target_values(resolved_target, "entity_id")
    for user_id in user_ids:
        for entity_id in entities_by_user[user_id]:
            if entity_id not in entity_ids:
                entity_ids.append(entity_id)
    if entity_ids:
        resolved_target["entity_id"] = entity_ids

    return resolved_target


def resolve_target_devices(
    notification_target: Any, registry_snapshot: RegistrySnapshot
) -> TargetResolution:
    if not isinstance(notification_target, dict):
        return TargetResolution(set(), set(), set())

    device_ids = set(target_values(notification_target, "device_id"))
    area_ids = set(target_values(notification_target, "area_id"))
    floor_ids = set(target_values(notification_target, "floor_id"))
    label_ids = set(target_values(notification_target, "label_id"))
    area_ids.update(
        area.area_id
        for area in registry_snapshot.area_registry.areas.values()
        if area.floor_id in floor_ids
    )
    for device in registry_snapshot.device_registry.devices.values():
        if device.area_id in area_ids or label_ids.intersection(
            getattr(device, "labels", set())
        ):
            device_ids.add(device.id)
    config_entry_ids = {
        entry_id
        for device in registry_snapshot.device_registry.devices.values()
        if device.id in device_ids
        for entry_id in getattr(device, "config_entries", set())
    }
    return TargetResolution(device_ids, area_ids, config_entry_ids)


def mobile_app_notify_services_for_target(
    notification_target: Any, registry_snapshot: RegistrySnapshot
) -> list[str]:
    if not isinstance(notification_target, dict):
        return []
    from .mobile_app import resolve_legacy_mobile_app_services

    resolution = resolve_target_devices(notification_target, registry_snapshot)
    resolved = resolve_legacy_mobile_app_services(
        registry_snapshot,
        target_values(notification_target, "entity_id"),
        resolution.device_ids,
        registry_snapshot.has_service,
    )
    return [f"notify.{service}" for service in resolved.services]


def _user_device_ids(
    registry_snapshot: RegistrySnapshot, user_ids: list[str]
) -> dict[str, set[str]]:
    devices_by_user: dict[str, set[str]] = {user_id: set() for user_id in user_ids}

    for person in registry_snapshot.person_states:
        user_id = str(person.attributes.get("user_id") or "")
        if user_id not in devices_by_user:
            continue

        trackers = person.attributes.get("device_trackers", [])
        if isinstance(trackers, str):
            trackers = [trackers]
        if not isinstance(trackers, list):
            continue

        for tracker in trackers:
            entry = registry_snapshot.entity_registry.entities.get(str(tracker))
            device_id = getattr(entry, "device_id", None)
            if device_id:
                devices_by_user[user_id].add(str(device_id))

    return devices_by_user
