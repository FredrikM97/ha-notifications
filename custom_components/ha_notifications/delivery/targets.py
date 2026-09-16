"""Target and registry resolution for notification delivery."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


@dataclass(frozen=True)
class RegistrySnapshot:
    """Home Assistant registries/state needed to plan one delivery."""

    area_registry: Any
    device_registry: Any
    entity_registry: Any
    mobile_app_entries: list[Any]
    mobile_app_entry_ids: set[str]
    person_states: list[Any]

GENERIC_NOTIFY_TARGET_KEYS = (
    "device_id",
    "area_id",
    "floor_id",
    "label_id",
    "entity_id",
)
GENERIC_NOTIFY_SERVICE = "send_message"


class DeliveryType(StrEnum):
    LEGACY_MOBILE_APP = "legacy_mobile_app"
    GENERIC_NOTIFY = "generic_notify"
    NO_RECIPIENTS = "no_recipients"


@dataclass(frozen=True)
class TargetResolution:
    device_ids: set[str]
    area_ids: set[str]
    config_entry_ids: set[str]


def classify_delivery_type(
    target: dict[str, Any],
    has_user_recipients: bool,
    has_legacy_services: bool,
    has_unresolved_recipients: bool,
) -> DeliveryType:
    if has_user_recipients:
        return DeliveryType.GENERIC_NOTIFY
    if has_legacy_services and not has_unresolved_recipients:
        return DeliveryType.LEGACY_MOBILE_APP
    if target:
        return DeliveryType.GENERIC_NOTIFY
    return DeliveryType.NO_RECIPIENTS


def target_values(target: dict[str, Any], key: str) -> list[str]:
    values = target.get(key, [])
    if not isinstance(values, list):
        values = [values]
    return [str(value) for value in values if value]


def generic_service_target(target: dict[str, Any]) -> dict[str, list[str]]:
    return {
        key: target_values(target, key)
        for key in GENERIC_NOTIFY_TARGET_KEYS
        if target_values(target, key)
    }


def resolve_user_notification_target(
    snapshot: RegistrySnapshot, target: Any
) -> tuple[dict[str, Any], bool]:
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
        for entry in snapshot.mobile_app_entries
        if isinstance(getattr(entry, "data", None), dict) and entry.data.get("user_id")
    }
    entities_by_user: dict[str, list[str]] = {user_id: [] for user_id in user_ids}
    device_ids_by_user = _user_device_ids(snapshot, user_ids)

    for entity in snapshot.entity_registry.entities.values():
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

    return resolved_target, True


def _user_device_ids(
    snapshot: RegistrySnapshot, user_ids: list[str]
) -> dict[str, set[str]]:
    devices_by_user: dict[str, set[str]] = {user_id: set() for user_id in user_ids}

    for person in snapshot.person_states:
        user_id = str(person.attributes.get("user_id") or "")
        if user_id not in devices_by_user:
            continue

        trackers = person.attributes.get("device_trackers", [])
        if isinstance(trackers, str):
            trackers = [trackers]
        if not isinstance(trackers, list):
            continue

        for tracker in trackers:
            entry = snapshot.entity_registry.entities.get(str(tracker))
            device_id = getattr(entry, "device_id", None)
            if device_id:
                devices_by_user[user_id].add(str(device_id))

    return devices_by_user


def resolve_target_devices(target: Any, snapshot: RegistrySnapshot) -> TargetResolution:
    if not isinstance(target, dict):
        return TargetResolution(set(), set(), set())

    device_ids = set(target_values(target, "device_id"))
    area_ids = set(target_values(target, "area_id"))
    floor_ids = set(target_values(target, "floor_id"))
    label_ids = set(target_values(target, "label_id"))

    area_ids.update(
        area.area_id
        for area in snapshot.area_registry.areas.values()
        if area.floor_id in floor_ids
    )

    for device in snapshot.device_registry.devices.values():
        if device.area_id in area_ids or label_ids.intersection(
            getattr(device, "labels", set())
        ):
            device_ids.add(device.id)

    config_entry_ids = {
        entry_id
        for device in snapshot.device_registry.devices.values()
        if device.id in device_ids
        for entry_id in getattr(device, "config_entries", set())
    }

    return TargetResolution(device_ids, area_ids, config_entry_ids)


def notification_services_for_target(
    snapshot: RegistrySnapshot,
    target: Any,
    resolution: TargetResolution | None = None,
) -> list[str]:
    if not isinstance(target, dict):
        return []

    resolution = resolution or resolve_target_devices(target, snapshot)
    entity_ids = target_values(target, "entity_id")
    label_ids = set(target_values(target, "label_id"))
    services = []

    for entity in snapshot.entity_registry.entities.values():
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
