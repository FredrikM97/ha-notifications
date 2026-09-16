"""Tests for notification target resolution."""

from types import SimpleNamespace

from custom_components.ha_notifications.delivery.targets import (
    RegistrySnapshot,
    mobile_app_notify_services_for_target,
    resolve_target_devices,
    resolve_user_notification_target,
    target_values,
)


def snapshot_with_user_and_devices():
    return RegistrySnapshot(
        area_registry=SimpleNamespace(
            areas={"area_1": SimpleNamespace(area_id="area_1", floor_id="floor_1")}
        ),
        device_registry=SimpleNamespace(
            devices={
                "device_1": SimpleNamespace(
                    id="device_1",
                    area_id="area_1",
                    labels={"critical"},
                    config_entries={"mobile_entry"},
                )
            }
        ),
        entity_registry=SimpleNamespace(
            entities={
                "sensor.tracker": SimpleNamespace(
                    entity_id="sensor.tracker",
                    device_id="device_1",
                    config_entry_id=None,
                ),
                "notify.phone": SimpleNamespace(
                    entity_id="notify.phone",
                    device_id="device_1",
                    config_entry_id="mobile_entry",
                ),
            }
        ),
        mobile_app_entries=[
            SimpleNamespace(
                entry_id="mobile_entry",
                data={"user_id": "user_1", "device_name": "phone"},
            )
        ],
        person_states=[
            SimpleNamespace(
                attributes={"user_id": "user_1", "device_trackers": ["sensor.tracker"]}
            )
        ],
        has_service=lambda domain, service: domain == "notify"
        and service == "mobile_app_phone",
    )


def test_target_helpers_resolve_user_area_floor_label_and_mobile_service():
    snapshot = snapshot_with_user_and_devices()

    assert target_values({"entity_id": "notify.phone"}, "entity_id") == [
        "notify.phone"
    ]
    resolved_user = resolve_user_notification_target(
        snapshot, {"user_id": ["user_1"]}
    )
    assert resolved_user["entity_id"] == ["notify.phone"]

    resolved = resolve_target_devices(
        {"floor_id": "floor_1", "label_id": "critical"}, snapshot
    )
    assert resolved.device_ids == {"device_1"}
    assert resolved.area_ids == {"area_1"}
    assert resolved.config_entry_ids == {"mobile_entry"}
    assert mobile_app_notify_services_for_target(
        {"device_id": ["device_1"]}, snapshot
    ) == ["notify.mobile_app_phone"]