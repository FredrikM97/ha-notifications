"""Legacy Mobile App notify-service resolution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .targets import RegistrySnapshot

HasService = Callable[[str, str], bool]


@dataclass(frozen=True)
class LegacyMobileAppResolution:
    """Resolved legacy service names and the devices they represent."""

    device_ids: set[str]
    services: list[str]


def resolve_legacy_mobile_app_services(
    snapshot: RegistrySnapshot,
    entity_ids: list[str],
    device_ids: set[str],
    has_service: HasService,
) -> LegacyMobileAppResolution:
    mobile_entry_ids, entity_device_ids = _mobile_app_entry_ids_for_entities(
        entity_ids, snapshot.entity_registry, snapshot.mobile_app_entry_ids
    )
    resolved_device_ids = device_ids | entity_device_ids
    device_entry_ids, names_by_entry_id = _mobile_app_entry_ids_and_names_for_devices(
        resolved_device_ids, snapshot.device_registry, snapshot.mobile_app_entry_ids
    )
    mobile_entry_ids.update(device_entry_ids)
    _add_mobile_app_entry_names(
        snapshot.mobile_app_entries, mobile_entry_ids, names_by_entry_id
    )

    return LegacyMobileAppResolution(
        resolved_device_ids,
        _verified_legacy_mobile_app_services(names_by_entry_id, has_service),
    )


def _mobile_app_entry_ids_for_entities(
    entity_ids: list[str],
    entity_registry: Any,
    mobile_app_entry_ids: set[str],
) -> tuple[set[str], set[str]]:
    entry_ids, device_ids = set(), set()
    for entity_id in entity_ids:
        entity = entity_registry.entities.get(entity_id)
        entry_id = getattr(entity, "config_entry_id", None)
        if entry_id in mobile_app_entry_ids:
            entry_ids.add(entry_id)
        if device_id := getattr(entity, "device_id", None):
            device_ids.add(device_id)
    return entry_ids, device_ids


def _mobile_app_entry_ids_and_names_for_devices(
    device_ids: set[str],
    device_registry: Any,
    mobile_app_entry_ids: set[str],
) -> tuple[set[str], dict[str, list[str]]]:
    entry_ids, names_by_entry_id = set(), {}
    for device_id in device_ids:
        device = device_registry.devices.get(device_id)
        if device is None:
            continue
        for entry_id in set(getattr(device, "config_entries", set())).intersection(
            mobile_app_entry_ids
        ):
            entry_ids.add(entry_id)
            for name in (
                getattr(device, "name_by_user", None),
                getattr(device, "name", None),
            ):
                if name:
                    names_by_entry_id.setdefault(entry_id, []).append(str(name))
    return entry_ids, names_by_entry_id


def _add_mobile_app_entry_names(
    mobile_app_entries: list[Any],
    entry_ids: set[str],
    names_by_entry_id: dict[str, list[str]],
) -> None:
    for entry in mobile_app_entries:
        if entry.entry_id not in entry_ids:
            continue
        entry_data = (
            getattr(entry, "data", {})
            if isinstance(getattr(entry, "data", {}), dict)
            else {}
        )
        for name in (getattr(entry, "title", None), entry_data.get("device_name")):
            if name:
                names_by_entry_id.setdefault(entry.entry_id, []).append(str(name))


def _legacy_mobile_app_service_name(name: str) -> str:
    return "mobile_app_" + name.lower().replace(" ", "_").replace("-", "_")


def _verified_legacy_mobile_app_services(
    names_by_entry_id: dict[str, list[str]],
    has_service: HasService,
) -> list[str]:
    services = []
    for names in names_by_entry_id.values():
        for name in names:
            service = _legacy_mobile_app_service_name(name)
            if service not in services and has_service("notify", service):
                services.append(service)
    return services
