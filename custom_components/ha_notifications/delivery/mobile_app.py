"""Resolve registered Mobile App notify services for selected targets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .targets import RegistrySnapshot

HasService = Callable[[str, str], bool]


@dataclass(frozen=True)
class LegacyMobileAppResolution:
    """Resolved Mobile App service names and their device IDs."""

    device_ids: set[str]
    services: list[str]


def resolve_legacy_mobile_app_services(
    registry_snapshot: RegistrySnapshot,
    entity_ids: list[str],
    device_ids: set[str],
    has_service: HasService | None,
) -> LegacyMobileAppResolution:
    mobile_entry_ids = {
        entry.entry_id for entry in registry_snapshot.mobile_app_entries
    }
    matched_entry_ids, entity_device_ids = _mobile_app_entry_ids_for_entities(
        entity_ids,
        registry_snapshot.entity_registry,
        mobile_entry_ids,
    )
    resolved_device_ids = device_ids | entity_device_ids
    for entry in registry_snapshot.mobile_app_entries:
        entry_data = getattr(entry, "data", None)
        if (
            isinstance(entry_data, dict)
            and str(entry_data.get("device_id")) in resolved_device_ids
        ):
            matched_entry_ids.add(entry.entry_id)
    device_entry_ids, names_by_entry_id = _mobile_app_entry_ids_and_names_for_devices(
        resolved_device_ids,
        registry_snapshot.device_registry,
        mobile_entry_ids,
    )
    matched_entry_ids.update(device_entry_ids)
    _add_mobile_app_entry_names(
        registry_snapshot.mobile_app_entries,
        matched_entry_ids,
        names_by_entry_id,
    )
    for entry in registry_snapshot.mobile_app_entries:
        entry_data = getattr(entry, "data", None)
        if not isinstance(entry_data, dict) or not entry_data.get("device_name"):
            continue
        service = _mobile_app_service_name(str(entry_data["device_name"]))
        if f"notify.{service}" in entity_ids:
            matched_entry_ids.add(entry.entry_id)
            names_by_entry_id.setdefault(entry.entry_id, []).append(
                str(entry_data["device_name"])
            )

    return LegacyMobileAppResolution(
        resolved_device_ids,
        _verified_mobile_app_services(names_by_entry_id, has_service),
    )


def _mobile_app_entry_ids_for_entities(
    entity_ids: list[str],
    entity_registry: Any,
    mobile_entry_ids: set[str],
) -> tuple[set[str], set[str]]:
    entry_ids: set[str] = set()
    device_ids: set[str] = set()
    for entity_id in entity_ids:
        entity = entity_registry.entities.get(entity_id)
        entry_id = getattr(entity, "config_entry_id", None)
        if entry_id in mobile_entry_ids:
            entry_ids.add(entry_id)
        if device_id := getattr(entity, "device_id", None):
            device_ids.add(device_id)
    return entry_ids, device_ids


def _mobile_app_entry_ids_and_names_for_devices(
    device_ids: set[str],
    device_registry: Any,
    mobile_entry_ids: set[str],
) -> tuple[set[str], dict[str, list[str]]]:
    entry_ids: set[str] = set()
    names_by_entry_id: dict[str, list[str]] = {}
    for device_id in device_ids:
        device = device_registry.async_get(device_id)
        if device is None:
            continue
        for entry_id in set(getattr(device, "config_entries", set())).intersection(
            mobile_entry_ids
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
        entry_data = getattr(entry, "data", {})
        if not isinstance(entry_data, dict):
            entry_data = {}
        for name in (getattr(entry, "title", None), entry_data.get("device_name")):
            if name:
                names_by_entry_id.setdefault(entry.entry_id, []).append(str(name))


def _mobile_app_service_name(name: str) -> str:
    return "mobile_app_" + name.lower().replace(" ", "_").replace("-", "_")


def _verified_mobile_app_services(
    names_by_entry_id: dict[str, list[str]],
    has_service: HasService | None,
) -> list[str]:
    services: list[str] = []
    for names in names_by_entry_id.values():
        for name in names:
            service = _mobile_app_service_name(name)
            if service in services:
                continue
            if has_service is not None and not has_service("notify", service):
                continue
            services.append(service)
    return services