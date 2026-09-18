"""Tests for notification target resolution."""

from custom_components.ha_notifications.delivery.targets import (
    mobile_app_notify_services_for_target,
    resolve_target_devices,
    resolve_user_notification_target,
    target_values,
)
from tests.backend.conftest import target_registry_snapshot


def test_target_helpers_resolve_all_target_types(snapshot):
    registry = target_registry_snapshot()

    assert target_values({"entity_id": "notify.phone"}, "entity_id") == [
        "notify.phone"
    ]
    resolved_user = resolve_user_notification_target(
        registry, {"user_id": ["user_1"]}
    )
    target_results = {}
    for target_type, target in {
        "device": {"device_id": "device_1"},
        "area": {"area_id": "area_1"},
        "floor": {"floor_id": "floor_1"},
        "label": {"label_id": "critical"},
        "user": resolved_user,
    }.items():
        resolved = resolve_target_devices(target, registry)
        target_results[target_type] = {
            "device_ids": sorted(resolved.device_ids),
            "area_ids": sorted(resolved.area_ids),
            "config_entry_ids": sorted(resolved.config_entry_ids),
            "services": mobile_app_notify_services_for_target(target, registry),
        }

    assert target_results == snapshot


async def test_real_home_assistant_registries_resolve_all_target_types(
    real_target_registry, snapshot
):
    registry = real_target_registry.snapshot
    resolved_user = resolve_user_notification_target(
        registry, {"user_id": ["user_1"]}
    )
    target_results = {}
    for target_type, target in {
        "device": {"device_id": real_target_registry.device_id},
        "area": {"area_id": real_target_registry.area_id},
        "floor": {"floor_id": "floor_1"},
        "label": {"label_id": "critical"},
        "user": resolved_user,
    }.items():
        resolved = resolve_target_devices(target, registry)
        target_results[target_type] = {
            "device_ids": [
                "<device>" if value == real_target_registry.device_id else value
                for value in sorted(resolved.device_ids)
            ],
            "area_ids": [
                "<area>" if value == real_target_registry.area_id else value
                for value in sorted(resolved.area_ids)
            ],
            "config_entry_ids": sorted(resolved.config_entry_ids),
            "services": mobile_app_notify_services_for_target(target, registry),
        }

    assert target_results == snapshot