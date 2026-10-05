"""Tests for the canonical notification service boundary."""

from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.service import async_get_all_descriptions

from custom_components.ha_notifications.automation import _SendComponent
from custom_components.ha_notifications.configuration import AlertConfig
from custom_components.ha_notifications.const import (
    COMMAND_CANCEL_RUN,
    DOMAIN,
    EVENT_COMMAND,
)
from custom_components.ha_notifications.domain import RuntimeData
from custom_components.ha_notifications.history import HistoryStore
from custom_components.ha_notifications.notification import (
    _parse_notification,
    _payload,
    async_setup_services,
)
from tests.backend.conftest import MockConfigEntry, async_mock_service


def test_parse_notification_returns_a_copy_of_the_payload() -> None:
    notification = _parse_notification({
        "action": "notify.mobile_app_phone",
        "target": {"entity_id": ["notify.phone"]},
        "title": "Water",
        "message": "Low water",
        "data": {"tag": "low_water"},
        "custom": "value",
    })

    assert notification == {
        "action": "notify.mobile_app_phone",
        "target": {"entity_id": ["notify.phone"]},
        "title": "Water",
        "message": "Low water",
        "data": {"tag": "low_water"},
        "custom": "value",
    }


def test_payload_preserves_an_empty_notification_message() -> None:
    assert _payload({"message": ""}, False, "empty_alert") == {
        "message": "",
        "data": {"tag": "empty_alert"},
    }


def test_parse_notification_discards_editor_options_without_mutating_input() -> None:
    payload = {
        "message": "Low water",
        "editor_options": {"fields": {"mobile.color": {"enabled": False, "value": "#ff0000"}}},
        "notification_native": {"priority": "high"},
    }

    notification = _parse_notification(payload)

    assert "editor_options" not in notification
    assert notification["notification_native"] == {"priority": "high"}
    assert "editor_options" in payload


@pytest.mark.asyncio
async def test_async_setup_services_registers_send_and_clear(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    assert hass.services.has_service(DOMAIN, "send")
    assert hass.services.has_service(DOMAIN, "clear")
    assert not hass.services.has_service(DOMAIN, "record")
    assert hass.services.has_service(DOMAIN, "report")
    assert hass.services.has_service(DOMAIN, "command")
    assert not hass.services.has_service(DOMAIN, "trigger")
    assert not hass.services.has_service(DOMAIN, "resolve")


@pytest.mark.asyncio
async def test_service_manifest_passes_home_assistant_description_validation(
    hass: HomeAssistant,
    enable_custom_integrations,
) -> None:
    await async_setup_services(hass)

    descriptions = await async_get_all_descriptions(hass)

    assert DOMAIN in descriptions
    assert "send" in descriptions[DOMAIN]
    assert "clear" in descriptions[DOMAIN]
    assert "report" in descriptions[DOMAIN]
    assert "record" not in descriptions[DOMAIN]
    assert "command" in descriptions[DOMAIN]


@pytest.mark.asyncio
async def test_action_executed_report_records_history_without_run_id(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    history = type("History", (), {"async_record": AsyncMock()})()
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = type("RuntimeData", (), {"history": history})()

    await hass.services.async_call(
        DOMAIN,
        "report",
        {
            "alert_id": "water",
            "status": "action_executed",
            "details": {"action": "light.turn_on"},
        },
        blocking=True,
    )

    history.async_record.assert_awaited_once_with(
        "water",
        "water",
        "action_executed",
        "Action Executed",
        {"action": "light.turn_on"},
    )


@pytest.mark.asyncio
async def test_command_fires_alert_scoped_event(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    events = []
    hass.bus.async_listen("ha_notifications_command", callback(lambda event: events.append(event)))

    await hass.services.async_call(
        DOMAIN,
        "command",
        {"alert_id": "water", "command": "skip_confirmation"},
        blocking=True,
    )

    assert len(events) == 1
    assert events[0].event_type == "ha_notifications_command"
    assert events[0].data == {
        "alert_id": "water",
        "command": "skip_confirmation",
    }


@pytest.mark.asyncio
async def test_inactive_report_records_once_and_only_cancels_after_activity(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    history = HistoryStore(hass)
    entry.runtime_data = type("RuntimeData", (), {"history": history})()
    events = []
    hass.bus.async_listen(EVENT_COMMAND, callback(lambda event: events.append(event)))

    await hass.services.async_call(
        DOMAIN,
        "report",
        {
            "alert_id": "door",
            "status": "inactive",
            "cancel_on_inactive": True,
        },
        blocking=True,
    )
    assert [
        item["event"]["type"] for item in await history.async_entries("door")
    ] == ["inactive"]
    assert events == []
    await hass.services.async_call(
        DOMAIN,
        "report",
        {"alert_id": "door", "status": "inactive"},
        blocking=True,
    )
    assert [
        item["event"]["type"] for item in await history.async_entries("door")
    ] == ["inactive"]

    await hass.services.async_call(
        DOMAIN,
        "report",
        {"alert_id": "door", "status": "started", "run_id": "run-1"},
        blocking=True,
    )
    await hass.services.async_call(
        DOMAIN,
        "report",
        {
            "alert_id": "door",
            "status": "inactive",
            "cancel_on_inactive": True,
        },
        blocking=True,
    )
    await hass.services.async_call(
        DOMAIN,
        "report",
        {"alert_id": "door", "status": "inactive"},
        blocking=True,
    )

    assert [
        item["event"]["type"] for item in await history.async_entries("door")
    ] == ["inactive", "started", "inactive"]
    assert [event.data for event in events] == [{
        "alert_id": "door",
        "command": COMMAND_CANCEL_RUN,
    }]


@pytest.mark.asyncio
async def test_inactive_report_does_not_cancel_waits_by_default(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    history = HistoryStore(hass)
    entry.runtime_data = type("RuntimeData", (), {"history": history})()
    events = []
    hass.bus.async_listen(EVENT_COMMAND, callback(lambda event: events.append(event)))

    await hass.services.async_call(
        DOMAIN,
        "report",
        {"alert_id": "door", "status": "started", "run_id": "run-1"},
        blocking=True,
    )
    await hass.services.async_call(
        DOMAIN,
        "report",
        {"alert_id": "door", "status": "inactive"},
        blocking=True,
    )

    assert [
        item["event"]["type"] for item in await history.async_entries("door")
    ] == ["inactive", "started"]
    assert events == []


@pytest.mark.asyncio
async def test_send_resolves_explicit_notify_targets(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = type("RuntimeData", (), {"history": type(
        "History", (), {"async_record": AsyncMock()}
    )()})()
    phone_calls = async_mock_service(hass, "notify", "phone")
    tablet_calls = async_mock_service(hass, "notify", "tablet")
    await hass.services.async_call(
        DOMAIN,
        "send",
        {
            "alert_id": "water",
            "target": {"entity_id": ["notify.phone", "notify.tablet"]},
            "title": "Water",
            "message": "Low water",
            "data": {"tag": "low_water"},
        },
        blocking=True,
    )
    assert phone_calls[0].data == {
        "title": "Water",
        "message": "Low water",
        "data": {"tag": "low_water"},
    }
    assert tablet_calls[0].data == {
        "title": "Water",
        "message": "Low water",
        "data": {"tag": "low_water"},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("nested_options", [False, True], ids=["flat", "nested"])
async def test_send_preserves_companion_option_placement_from_stored_alert(
    hass: HomeAssistant, alert_factory, nested_options: bool,
) -> None:
    options = {
        "group": "water",
        "channel": "Alerts",
        "push": {"sound": {"name": "default", "critical": 1, "volume": 1.0}},
        "ttl": 0,
        "priority": "high",
    }
    option_data = {"data": options} if nested_options else options
    stored = alert_factory(notification={
        "action": "notify.mobile_app_phone",
        "target": {"entity_id": ["notify.mobile_app_phone"]},
        "data": {"title": "Water", "message": "Low water", **option_data},
    })
    alert = AlertConfig.model_validate(stored)
    before = alert.model_dump(mode="python")
    notification = _SendComponent.notification_mapping(alert.notification)
    assert notification["data"] == stored["notification"]["data"]
    await async_setup_services(hass)
    config = {"version": 1, "alerts": [stored]}
    entry = MockConfigEntry(domain=DOMAIN, data=config)
    entry.add_to_hass(hass)
    entry.runtime_data = RuntimeData(config=config, history=HistoryStore(hass))
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    await hass.services.async_call(
        DOMAIN,
        "send",
        {"alert_id": alert.id, **notification},
        blocking=True,
    )

    assert len(calls) == 1
    assert calls[0].data == {
        "title": "Water",
        "message": "Low water",
        "data": {**option_data, "tag": alert.id},
    }
    assert alert.model_dump(mode="python") == before


@pytest.mark.asyncio
@pytest.mark.parametrize("service", ["send", "clear"])
@pytest.mark.parametrize("payload_source", ["mapped", "direct_flat", "direct_nested"])
async def test_delivery_excludes_notification_editor_options(
    hass: HomeAssistant, alert_factory, service: str, payload_source: str,
) -> None:
    stored = alert_factory(notification={
        "action": "notify.mobile_app_phone",
        "target": {"entity_id": ["notify.mobile_app_phone"]},
        "title": "Water",
        "message": "Low water",
        "data": {"priority": "high"},
        "editor_options": {
            "fields": {
                "mobile.color": {"enabled": False, "value": "#ff0000"},
                "android.channel": {"enabled": False, "value": "Disabled channel"},
                "ios.sound": {"enabled": False, "value": "disabled.aiff"},
            },
            "sections": {
                "android": {"enabled": False, "values": {"channel": "Disabled channel", "ttl": 0}},
                "ios": {"enabled": False, "values": {"push": {"sound": "disabled.aiff"}}},
            },
        },
    })
    alert = AlertConfig.model_validate(stored)
    serialized = alert.notification.model_dump(mode="json", exclude_none=True)
    before = alert.model_dump(mode="python")
    mapped = _SendComponent.notification_mapping(alert.notification)
    assert "editor_options" not in mapped
    assert mapped["data"] == {"priority": "high"}
    if payload_source == "mapped":
        payload = mapped
    elif payload_source == "direct_flat":
        payload = serialized
    else:
        payload = {"notification": serialized}

    await async_setup_services(hass)
    config = {"version": 1, "alerts": [stored]}
    entry = MockConfigEntry(domain=DOMAIN, data=config)
    entry.add_to_hass(hass)
    entry.runtime_data = RuntimeData(config=config, history=HistoryStore(hass))
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    await hass.services.async_call(
        DOMAIN,
        service,
        {"alert_id": alert.id, **payload},
        blocking=True,
    )

    assert len(calls) == 1
    assert calls[0].data == {
        "title": "Water",
        "message": "clear_notification" if service == "clear" else "Low water",
        "data": {"priority": "high", "tag": alert.id},
        **({"entity_id": ["notify.mobile_app_phone"]} if payload_source != "mapped" else {}),
    }
    assert alert.model_dump(mode="python") == before
    assert serialized["editor_options"] == stored["notification"]["editor_options"]


@pytest.mark.asyncio
async def test_send_preserves_dynamic_target_selectors(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    area = ar.async_get(hass).async_create("Kitchen")
    mobile_entry = MockConfigEntry(
        domain="mobile_app",
        title="Phone",
    )
    mobile_entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=mobile_entry.entry_id,
        identifiers={("mobile_app", "phone")},
    )
    dr.async_get(hass).async_update_device(device.id, area_id=area.id)
    er.async_get(hass).async_get_or_create(
        "notify",
        "mobile_app",
        "phone",
        suggested_object_id="phone",
        device_id=device.id,
    )
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    await hass.services.async_call(
        DOMAIN,
        "send",
        {
            "target": {"area_id": [area.id]},
            "data": {"message": "Kitchen alert"},
        },
        blocking=True,
    )

    assert calls[0].data == {
        "message": "Kitchen alert",
    }


@pytest.mark.asyncio
async def test_send_nests_mobile_app_actions_in_notify_data(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    await hass.services.async_call(
        DOMAIN,
        "send",
        {
            "action": "notify.mobile_app_phone",
            "message": "Confirm this alert",
            "data": {
                "actions": [{
                    "action": "ha_notifications_alert_confirmation_confirm",
                    "title": "Confirm",
                }],
            },
        },
        blocking=True,
    )

    assert calls[0].data == {
        "message": "Confirm this alert",
        "data": {
            "actions": [{
                "action": "ha_notifications_alert_confirmation_confirm",
                "title": "Confirm",
            }],
        },
    }


@pytest.mark.asyncio
async def test_send_records_managed_alert_history(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    async_mock_service(hass, "notify", "mobile_app_phone")
    history = type("History", (), {"async_record": AsyncMock()})()
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = type("RuntimeData", (), {"history": history})()

    await hass.services.async_call(
        DOMAIN,
        "send",
        {
            "alert_id": "water",
            "alert_name": "Water alert",
            "flow_id": "flow-1",
            "notification": {"action": "notify.mobile_app_phone"},
        },
        blocking=True,
    )

    history.async_record.assert_awaited_once_with(
        "water",
        "Water alert",
        "notification_sent",
        "Notification sent",
        {"service": "notify.mobile_app_phone"},
        flow_id="flow-1",
    )


@pytest.mark.asyncio
async def test_report_resolves_confirmation_to_device_name(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    history = type("History", (), {"async_record": AsyncMock()})()
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = type("RuntimeData", (), {"history": history})()
    mobile_entry = MockConfigEntry(domain="mobile_app", title="Phone")
    mobile_entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=mobile_entry.entry_id,
        identifiers={("mobile_app", "phone")},
    )
    dr.async_get(hass).async_update_device(
        device.id,
        name_by_user="Living Room Phone",
    )

    await hass.services.async_call(
        DOMAIN,
        "report",
        {
            "alert_id": "water",
            "status": "confirmation_completed",
            "run_id": "run-1",
            "details": {"device_id": device.id, "user_id": "user-1"},
        },
        blocking=True,
    )

    assert history.async_record.await_args.args[-1] == {"confirmed_by": "user-1"}


@pytest.mark.asyncio
async def test_send_renders_deferred_confirmation_message(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    history = type("History", (), {"async_record": AsyncMock()})()
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = type("RuntimeData", (), {"history": history})()
    mobile_entry = MockConfigEntry(domain="mobile_app", title="Phone")
    mobile_entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=mobile_entry.entry_id,
        identifiers={("mobile_app", "phone")},
    )
    dr.async_get(hass).async_update_device(
        device.id,
        name_by_user="Living Room Phone",
    )
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    await hass.services.async_call(
        DOMAIN,
        "send",
        {
            "alert_id": "water",
            "notification": {
                "action": "notify.mobile_app_phone",
                "data": {
                    "template_message": (
                        "Confirmed by {{confirmed_by}} ({{user_id}})"
                    ),
                    "confirmation_device_id": device.id,
                    "confirmation_user_id": "user-1",
                },
            },
        },
        blocking=True,
    )

    assert calls[0].data == {
        "message": "Confirmed by user-1 (user-1)",
        "data": {"tag": "water"},
    }


@pytest.mark.asyncio
async def test_report_resolves_confirmation_to_person_name(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    history = type("History", (), {"async_record": AsyncMock()})()
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = type("RuntimeData", (), {"history": history})()
    hass.states.async_set(
        "person.alice",
        "Alice",
        {"user_id": "user-1", "friendly_name": "Alice"},
    )

    await hass.services.async_call(
        DOMAIN,
        "report",
        {
            "alert_id": "water",
            "status": "confirmation_completed",
            "run_id": "run-1",
            "details": {"user_id": "user-1"},
        },
        blocking=True,
    )

    assert history.async_record.await_args.args[-1] == {"confirmed_by": "Alice"}


@pytest.mark.asyncio
async def test_report_resolves_confirmation_to_authenticated_user(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    history = type("History", (), {"async_record": AsyncMock()})()
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = type("RuntimeData", (), {"history": history})()
    user = await hass.auth.async_create_user("Authenticated Alice")

    await hass.services.async_call(
        DOMAIN,
        "report",
        {
            "alert_id": "water",
            "status": "confirmation_completed",
            "run_id": "run-1",
            "details": {"device_id": "missing-device", "user_id": user.id},
        },
        blocking=True,
    )

    assert history.async_record.await_args.args[-1] == {
        "confirmed_by": "Authenticated Alice",
    }


@pytest.mark.asyncio
async def test_report_uses_unknown_device_for_unresolved_confirmation(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    history = type("History", (), {"async_record": AsyncMock()})()
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = type("RuntimeData", (), {"history": history})()

    await hass.services.async_call(
        DOMAIN,
        "report",
        {
            "alert_id": "water",
            "status": "confirmation_completed",
            "run_id": "run-1",
            "details": {"device_id": "missing-device"},
        },
        blocking=True,
    )

    assert history.async_record.await_args.args[-1] == {
        "confirmed_by": "Unknown device",
    }


@pytest.mark.asyncio
async def test_clear_uses_canonical_action_and_clear_message(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    history = type("History", (), {"async_record": AsyncMock()})()
    entry.runtime_data = type("RuntimeData", (), {"history": history})()
    calls = async_mock_service(hass, "notify", "mobile_app_phone")
    await hass.services.async_call(
        DOMAIN,
        "clear",
        {
            "alert_id": "water",
            "notification": {"action": "notify.mobile_app_phone"},
        },
        blocking=True,
    )
    assert calls[0].data == {
        "message": "clear_notification",
        "data": {"tag": "water"},
    }
    assert history.async_record.await_args.args[:4] == (
        "water",
        "water",
        "notification_cleared",
        "Notification cleared",
    )


@pytest.mark.asyncio
async def test_send_propagates_delivery_service_failure(hass: HomeAssistant) -> None:
    failure = HomeAssistantError("delivery failed")
    await async_setup_services(hass)
    async_mock_service(hass, "notify", "mobile_app_phone", raise_exception=failure)
    with pytest.raises(HomeAssistantError, match="delivery failed") as raised:
        await hass.services.async_call(
            DOMAIN,
            "send",
            {"notification": {"action": "notify.mobile_app_phone"}},
            blocking=True,
        )
    assert raised.value is failure
