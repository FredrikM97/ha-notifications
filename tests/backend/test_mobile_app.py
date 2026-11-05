"""Runtime Companion discovery against real Home Assistant registries."""

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import floor_registry as fr
from homeassistant.helpers import label_registry as lr
from pytest_homeassistant.common import MockConfigEntry, async_mock_service

from custom_components.ha_notifications.bridge import websocket
from custom_components.ha_notifications.const import (
    CONFIG_ENTRY_MINOR_VERSION,
    CONFIG_ENTRY_VERSION,
    DOMAIN,
)
from custom_components.ha_notifications.mobile_app import resolve_platforms
from custom_components.ha_notifications.notification import async_setup_services


@pytest.fixture
def mobile_target(hass: HomeAssistant):
    """Create Companion registrations with realistic registry associations."""

    def create(os_name="Android", *, name="Phone", user_id="user-1"):
        entry = MockConfigEntry(
            version=CONFIG_ENTRY_VERSION,
            minor_version=CONFIG_ENTRY_MINOR_VERSION,
            domain="mobile_app",
            title=name,
            data={
                "os_name": os_name,
                "device_name": name,
                "user_id": user_id,
                "secret": "must-not-leak",
                "webhook_id": "private-webhook",
                "app_data": {"push_token": "private-token"},
            },
        )
        entry.add_to_hass(hass)
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={("mobile_app", entry.entry_id)},
            name=name,
            manufacturer="Apple",
        )
        entity = er.async_get(hass).async_get_or_create(
            "device_tracker",
            "mobile_app",
            entry.entry_id,
            config_entry=entry,
            device_id=device.id,
        )
        return entry, device, entity

    return create


async def test_platform_resolution_does_not_read_deprecated_device_ownership(
    hass,
    mobile_target,
    monkeypatch,
) -> None:
    _entry, device, _entity = mobile_target()

    def deprecated_ownership(_device):
        raise AssertionError("DeviceEntry.config_entries must not be used")

    monkeypatch.setattr(dr.DeviceEntry, "config_entries", property(deprecated_ownership))
    assert resolve_platforms(hass, {"device_id": device.id}) == {
        "platforms": ["android"],
        "unknown": False,
    }


@pytest.mark.parametrize(
    ("os_name", "platforms", "unknown"),
    [
        ("Android", ["android"], False),
        ("android", ["android"], False),
        ("iOS", ["ios"], False),
        ("iPadOS", ["ios"], False),
        ("macOS", ["ios"], False),
        (" IOS ", ["ios"], False),
        ("Linux", [], True),
        ("", [], True),
        (None, [], True),
        (42, [], True),
    ],
)
async def test_platforms_use_only_registration_os(
    hass,
    mobile_target,
    os_name,
    platforms,
    unknown,
) -> None:
    entry, device, _entity = mobile_target(os_name, name="Android iPhone")
    before = dict(entry.data)
    if os_name is None:
        hass.config_entries.async_update_entry(
            entry, data={key: value for key, value in entry.data.items() if key != "os_name"}
        )
        before = dict(entry.data)

    assert resolve_platforms(hass, {"device_id": device.id}) == {
        "platforms": platforms,
        "unknown": unknown,
    }
    assert dict(entry.data) == before
    assert not entry.options


@pytest.mark.parametrize(
    "selector",
    ["entity_id", "device_id", "area_id", "floor_id", "label_id", "user_id"],
)
async def test_platform_discovery_and_service_delivery_share_target_resolution(
    hass,
    mobile_target,
    selector,
    snapshot,
) -> None:
    _entry, device, entity = mobile_target()
    floor = fr.async_get(hass).async_create("Ground floor")
    area = ar.async_get(hass).async_create("Kitchen", floor_id=floor.floor_id)
    label = lr.async_get(hass).async_create("Recipients")
    dr.async_get(hass).async_update_device(
        device.id,
        area_id=area.id,
        labels={label.label_id},
    )
    values = {
        "entity_id": entity.entity_id,
        "device_id": device.id,
        "area_id": area.id,
        "floor_id": floor.floor_id,
        "label_id": label.label_id,
        "user_id": "user-1",
    }
    target = {selector: [values[selector]]}
    assert resolve_platforms(hass, target) == {
        "platforms": ["android"],
        "unknown": False,
    }
    await async_setup_services(hass)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    await hass.services.async_call(
        DOMAIN,
        "send",
        {"target": target, "payload": {"message": "Test"}},
        blocking=True,
    )

    assert len(calls) == 1
    assert [dict(call.data) for call in calls] == snapshot


@pytest.mark.parametrize(
    "target",
    [
        {},
        {"device_id": []},
        {"entity_id": "notify.missing"},
        {"device_id": "missing"},
        {"area_id": "missing"},
        {"floor_id": "missing"},
        {"label_id": "missing"},
        {"user_id": "missing"},
        {"unsupported": "value"},
    ],
)
async def test_empty_and_unresolved_targets_are_unknown(hass, target) -> None:
    assert resolve_platforms(hass, target) == {"platforms": [], "unknown": True}


@pytest.mark.parametrize(
    "unresolved",
    [
        {"entity_id": "notify.missing"},
        {"device_id": "missing"},
        {"area_id": "missing"},
        {"user_id": "missing"},
        {"unsupported": "value"},
    ],
)
async def test_mixed_targets_preserve_known_platforms_and_unknown(
    hass,
    mobile_target,
    unresolved,
) -> None:
    _entry, device, _entity = mobile_target()
    target = {"device_id": device.id, **unresolved}
    if "device_id" in unresolved:
        target["device_id"] = [device.id, unresolved["device_id"]]
    assert resolve_platforms(hass, target) == {
        "platforms": ["android"],
        "unknown": True,
    }


async def test_group_targets_deduplicate_platforms_and_include_unsupported_members(
    hass,
    mobile_target,
) -> None:
    area = ar.async_get(hass).async_create("Kitchen")
    for os_name in ("Android", "iOS", "iPadOS", "Linux"):
        _entry, device, _entity = mobile_target(os_name)
        dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    assert resolve_platforms(hass, {"area_id": area.id}) == {
        "platforms": ["android", "ios"],
        "unknown": True,
    }


async def test_non_companion_device_and_entity_are_unknown(hass) -> None:
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION, minor_version=CONFIG_ENTRY_MINOR_VERSION, domain="test"
    )
    entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={("test", "iphone")},
        name="iPhone",
        manufacturer="Apple",
    )
    entity = er.async_get(hass).async_get_or_create(
        "notify",
        "test",
        "iphone",
        config_entry=entry,
        device_id=device.id,
    )
    for target in ({"device_id": device.id}, {"entity_id": entity.entity_id}):
        assert resolve_platforms(hass, target) == {"platforms": [], "unknown": True}


async def test_registration_device_id_fallback_matches_service_delivery(hass, snapshot) -> None:
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain="mobile_app",
        title="Phone",
        data={"device_id": "registration-device", "os_name": "iOS"},
    )
    entry.add_to_hass(hass)
    target = {"device_id": "registration-device"}
    assert resolve_platforms(hass, target) == {"platforms": ["ios"], "unknown": False}
    await async_setup_services(hass)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")
    await hass.services.async_call(
        DOMAIN,
        "send",
        {"target": target, "payload": {"message": "Test"}},
        blocking=True,
    )
    assert len(calls) == 1
    assert [dict(call.data) for call in calls] == snapshot


async def test_registered_websocket_contract_is_admin_only_and_runtime_only(
    hass,
    mobile_target,
    hass_ws_client,
    hass_read_only_access_token,
    snapshot,
) -> None:
    entry, device, _entity = mobile_target()
    persisted = dict(entry.data)
    websocket.register(hass)
    client = await hass_ws_client()
    message = {
        "id": 1,
        "type": "ha_notifications/mobile_platforms",
        "target": {"device_id": device.id, "user_id": "user-1"},
    }
    await client.send_json(message)
    responses = {"initial": await client.receive_json()}
    assert dict(entry.data) == persisted
    assert not hass.config_entries.async_entries(DOMAIN)

    restricted = await hass_ws_client(access_token=hass_read_only_access_token)
    await restricted.send_json(message)
    responses["non_admin"] = await restricted.receive_json()
    assert responses["non_admin"]["error"]["code"] == "unauthorized"
    await client.send_json({"id": 2, "type": "ha_notifications/mobile_platforms"})
    responses["missing_target"] = await client.receive_json()

    hass.config_entries.async_update_entry(entry, data={**entry.data, "os_name": "iOS"})
    updated = dict(entry.data)
    await client.send_json({**message, "id": 3})
    responses["updated_registration"] = await client.receive_json()
    assert dict(entry.data) == updated
    assert not entry.options
    assert not hass.config_entries.async_entries(DOMAIN)
    assert responses == snapshot
