"""Tests for the canonical notification service boundary."""

from unittest.mock import AsyncMock

import pytest
import voluptuous as vol
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
    _parse_payload,
    _payload,
    async_setup_services,
)
from tests.backend.conftest import MockConfigEntry, async_mock_service


def test_parse_payload_returns_a_copy_of_the_payload() -> None:
    notification = _parse_payload({
        "title": "Water", "message": "Low water", "data": {"tag": "low_water"},
        "custom": "value",
    })

    assert notification == {
        "title": "Water", "message": "Low water", "data": {"tag": "low_water"},
        "custom": "value",
    }


@pytest.mark.parametrize("clear", [False, True])
@pytest.mark.parametrize("options", [{}, {"tag": "custom"}])
def test_payload_can_omit_default_tag_without_changing_explicit_tag(clear, options) -> None:
    native = {"message": "Separate notification", "data": options}
    assert _payload(native, clear, "alert", False) == {
        "message": "clear_notification" if clear else "Separate notification",
        "data": options,
    }
    assert native == {"message": "Separate notification", "data": options}


def test_payload_preserves_an_empty_notification_message() -> None:
    assert _payload({"message": ""}, False, "empty_alert") == {
        "message": "",
        "data": {"tag": "empty_alert"},
    }


def test_payload_passes_native_service_data_without_rebuilding_content() -> None:
    device_options = {"color": "#c7a600", "group": "derp", "subject": "bla bla bla"}
    service_data = {"title": "TEst text test", "message": "testtest", "data": device_options}
    notification = service_data

    assert _payload(notification, False, "content_alert") == {
        **service_data, "data": {**device_options, "tag": "content_alert"},
    }
    assert notification == service_data
    assert "tag" not in device_options


def test_parse_notification_copies_payload_without_mutating_input() -> None:
    payload = {
        "message": "Low water", "data": {"native_extra": {"priority": "high"}},
    }

    notification = _parse_payload(payload)

    assert notification == payload
    assert notification is not payload


@pytest.mark.parametrize("service_data", [{}, {"title": "Title only"}, {"subject": "Native extra"}])
def test_payload_does_not_synthesize_an_absent_message(service_data: dict) -> None:
    assert _payload(service_data, False, None) == service_data
    assert "message" not in _payload(service_data, False, "alert")


def test_payload_preserves_native_device_keys_that_resemble_internal_metadata() -> None:
    options = {
        "template_message": "Native metadata",
        "confirmation_device_id": "native-device",
        "confirmation_user_id": "native-user",
        "alert_id": "native-alert",
        "history_reason": "native-reason",
    }
    assert _payload({"data": options}, False, None) == {"data": options}


def test_payload_does_not_promote_device_content() -> None:
    notification = {
        "title": "Canonical title",
        "message": "Canonical message",
        "data": {"title": "Device title", "message": "Device message"},
    }
    assert _payload(notification, False, None) == notification


@pytest.mark.asyncio
@pytest.mark.parametrize("service", ["send", "clear"])
async def test_delivery_requires_native_payload(hass: HomeAssistant, service: str) -> None:
    await async_setup_services(hass)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    with pytest.raises(vol.Invalid):
        await hass.services.async_call(
            DOMAIN, service,
            {"action": "notify.mobile_app_phone", "data": {"message": "Not nested"}},
            blocking=True,
        )

    assert calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("service_data", [{}, {"title": "Title only"}])
async def test_send_does_not_synthesize_an_absent_message(
    hass: HomeAssistant, service_data: dict,
) -> None:
    await async_setup_services(hass)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    await hass.services.async_call(
        DOMAIN, "send",
        {"action": "notify.mobile_app_phone", "payload": service_data},
        blocking=True,
    )

    assert calls[0].data == service_data


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
@pytest.mark.parametrize("command", ["skip_confirmation", COMMAND_CANCEL_RUN])
async def test_command_fires_alert_scoped_event(
    hass: HomeAssistant,
    command: str,
) -> None:
    await async_setup_services(hass)
    events = []
    hass.bus.async_listen("ha_notifications_command", callback(lambda event: events.append(event)))

    await hass.services.async_call(
        DOMAIN,
        "command",
        {"alert_id": "water", "command": command},
        blocking=True,
    )

    assert len(events) == 1
    assert events[0].event_type == "ha_notifications_command"
    assert events[0].data == {
        "alert_id": "water",
        "command": command,
    }


@pytest.mark.asyncio
async def test_inactive_report_preserves_history_deduplication_without_cancellation(
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
    clear_calls = async_mock_service(hass, DOMAIN, "clear")
    notification_calls = async_mock_service(hass, "notify", "mobile_app_phone")
    report = {"alert_id": "door", "status": "inactive"}

    await hass.services.async_call(
        DOMAIN,
        "report",
        report,
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
        report,
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
    assert events == []
    assert clear_calls == []
    assert notification_calls == []


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
            "payload": {"title": "Water", "message": "Low water", "data": {"tag": "low_water"}},
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
@pytest.mark.parametrize("nested_options", [False, True], ids=["device-options", "opaque-nested-device-options"])
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
        "title": "Water", "message": "Low water", "options": option_data,
    })
    alert = AlertConfig.model_validate(stored)
    before = alert.model_dump(mode="python")
    notification = _SendComponent.notification_mapping(alert.notification)
    assert notification["payload"]["data"] == stored["notification"]["options"]
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
async def test_color_options_match_companion_documented_service_payload(
    hass: HomeAssistant, alert_factory,
) -> None:
    content = {
        "title": "Motion Detected in Backyard",
        "message": "Someone might be in the backyard.",
    }
    options = {
        "color": "#2DF56D",
        "persistent": True,
        "subject": "Motion details",
        "subtitle": "Backyard",
    }
    notification = {
        "action": "notify.mobile_app_phone",
        "target": {"entity_id": ["notify.mobile_app_phone"]},
        **content,
        "options": dict(options),
    }
    stored = alert_factory(notification=notification)
    alert = AlertConfig.model_validate(stored)
    mapped = _SendComponent.notification_mapping(alert.notification)
    await async_setup_services(hass)
    config = {"version": 1, "alerts": [stored]}
    entry = MockConfigEntry(domain=DOMAIN, data=config)
    entry.add_to_hass(hass)
    entry.runtime_data = RuntimeData(config=config, history=HistoryStore(hass))
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    await hass.services.async_call(
        DOMAIN, "send", {"alert_id": alert.id, **mapped}, blocking=True,
    )

    assert calls[0].data == {
        **content,
        "data": {**options, "tag": alert.id},
    }
    assert "data" not in calls[0].data["data"]
    assert "title" not in calls[0].data["data"]
    assert "message" not in calls[0].data["data"]


@pytest.mark.asyncio
@pytest.mark.parametrize("confirmation_enabled", [False, True], ids=["confirmation-off", "confirmation-on"])
@pytest.mark.parametrize(
    "platform_data",
    [
        pytest.param({}, id="general"),
        pytest.param(
            {
                "channel": "Water alerts",
                "importance": "high",
                "sticky": False,
                "persistent": True,
                "alert_once": False,
                "timeout": 0,
                "clickAction": "/lovelace/water",
                "vibrationPattern": "100, 1000, 100, 1000, 100",
                "ledColor": "#00ff00",
                "ttl": 0,
                "priority": "high",
            },
            id="android",
        ),
        pytest.param(
            {
                "push": {
                    "sound": {"name": "default", "critical": 1, "volume": 0.5},
                    "badge": 0,
                    "interruption-level": "critical",
                    "custom": {"enabled": False, "count": 0},
                },
            },
            id="ios",
        ),
    ],
)
async def test_send_preserves_mobile_data_from_generated_confirmation_notification(
    hass: HomeAssistant, alert_factory, platform_data: dict, confirmation_enabled: bool,
) -> None:
    mobile_data = {
        "color": "#123456",
        "group": "water",
        "notification_icon": "mdi:water",
        "tag": "user-water-tag",
        "custom": {"enabled": False, "count": 0, "values": ["water", 0, False]},
        **platform_data,
    }
    stored = alert_factory(
        notification={
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.mobile_app_phone"]},
            "title": "Water", "message": "Low water", "options": mobile_data,
        },
        confirmation={
            "enabled": confirmation_enabled,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "reminders": {
                "enabled": True,
                "interval": {"minutes": 5},
                "forget_after": {"enabled": False, "value": {"minutes": 30}},
            },
        },
    )
    alert = AlertConfig.model_validate(stored)
    before = alert.model_dump(mode="python")
    notification = _SendComponent()._confirmation_notification(alert)
    expected_data = dict(mobile_data)
    if confirmation_enabled:
        expected_data["actions"] = [{
            "action": f"ha_notifications_{alert.id}_confirmation_confirm",
            "title": "Confirm",
        }]
    assert notification == {
        "action": "notify.mobile_app_phone",
        "target": {"entity_id": ["notify.mobile_app_phone"]},
        "use_default_tag": True,
        "payload": {"title": "Water", "message": "Low water", "data": expected_data},
    }

    await async_setup_services(hass)
    config = {"version": 1, "alerts": [stored]}
    entry = MockConfigEntry(domain=DOMAIN, data=config)
    entry.add_to_hass(hass)
    history = HistoryStore(hass)
    entry.runtime_data = RuntimeData(config=config, history=history)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    await hass.services.async_call(
        DOMAIN,
        "send",
        {"alert_id": alert.id, "alert_name": alert.name, **notification},
        blocking=True,
    )

    assert len(calls) == 1
    assert calls[0].data == {
        "title": "Water",
        "message": "Low water",
        "data": expected_data,
    }
    delivered_data = calls[0].data["data"]
    assert delivered_data["custom"]["enabled"] is False
    assert type(delivered_data["custom"]["count"]) is int
    if "timeout" in platform_data:
        assert type(delivered_data["timeout"]) is int
        assert type(delivered_data["ttl"]) is int
        assert delivered_data["sticky"] is False
        assert delivered_data["alert_once"] is False
        assert delivered_data["persistent"] is True
    if "push" in platform_data:
        assert type(delivered_data["push"]["badge"]) is int
        assert delivered_data["push"]["custom"]["enabled"] is False
    assert "mobile_options" not in calls[0].data
    assert "mobile_options" not in delivered_data
    assert alert.model_dump(mode="python") == before
    assert stored["notification"]["options"] == mobile_data
    assert [
        item["event"]["type"] for item in await history.async_entries(alert.id)
    ] == ["notification_sent"]


@pytest.mark.asyncio
@pytest.mark.parametrize("service", ["send", "clear"])
async def test_delivery_keeps_integration_metadata_out_of_native_payload(
    hass: HomeAssistant, alert_factory, service: str,
) -> None:
    stored = alert_factory(
        notification={
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.mobile_app_phone"]},
            "title": "Water", "message": "Low water", "options": {"priority": "high"},
        },
    )
    alert = AlertConfig.model_validate(stored)
    before = alert.model_dump(mode="python")
    mapped = _SendComponent.notification_mapping(alert.notification)
    assert mapped["payload"]["data"] == stored["notification"]["options"]

    await async_setup_services(hass)
    config = {"version": 1, "alerts": [stored]}
    entry = MockConfigEntry(domain=DOMAIN, data=config)
    entry.add_to_hass(hass)
    entry.runtime_data = RuntimeData(config=config, history=HistoryStore(hass))
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    await hass.services.async_call(
        DOMAIN,
        service,
        {
            "alert_id": alert.id, "alert_name": alert.name, "flow_id": "flow-1",
            "history_reason": "native_boundary", "confirmation": {"user_id": "test-user"},
            **mapped,
        },
        blocking=True,
    )

    assert len(calls) == 1
    assert calls[0].data == {
        "title": "Water",
        "message": "clear_notification" if service == "clear" else "Low water",
        "data": {"priority": "high", "tag": alert.id},
    }
    assert alert.model_dump(mode="python") == before
    assert not {"alert_id", "alert_name", "flow_id", "history_reason", "confirmation", "target", "action", "notification"}.intersection(calls[0].data)


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
        {"target": {"area_id": [area.id]}, "payload": {"message": "Kitchen alert"}},
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
        {"action": "notify.mobile_app_phone", "payload": {
                    "message": "Confirm this alert",
                    "data": {"actions": [{
                        "action": "ha_notifications_alert_confirmation_confirm",
                        "title": "Confirm",
                    }]},
                }},
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
@pytest.mark.parametrize("service", ["send", "clear"])
async def test_delivery_debug_log_matches_notify_payload(
    hass: HomeAssistant, caplog: pytest.LogCaptureFixture, service: str,
) -> None:
    await async_setup_services(hass)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")
    logger = "custom_components.ha_notifications.notification"
    caplog.set_level("DEBUG", logger=logger)

    await hass.services.async_call(
        DOMAIN,
        service,
        {"action": "notify.mobile_app_phone", "payload": {"message": "Debug notification", "data": {"priority": "high", "ttl": 0, "actions": []}}},
        blocking=True,
    )

    records = [record for record in caplog.records if record.name == logger]
    assert len(calls) == 1
    assert records[0].args[-1] == calls[0].data
    assert records[0].args[0] == service
    assert records[0].args[1] == "notify.mobile_app_phone"
    assert records[1].getMessage() == (
        f"Notification {service} completed: action=notify.mobile_app_phone"
    )


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
        {"alert_id": "water", "alert_name": "Water alert", "flow_id": "flow-1", "action": "notify.mobile_app_phone", "payload": {}},
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
        {"alert_id": "water", "confirmation": {"device_id": device.id, "user_id": "user-1"}, "action": "notify.mobile_app_phone", "payload": {
                    "title": "Confirmation",
                    "message": (
                        "Confirmed by {{confirmed_by}} ({{user_id}})"
                    ),
                    "data": {
                        "color": "#2DF56D",
                        "template_message": "Native metadata",
                        "confirmation_device_id": "native-device",
                        "confirmation_user_id": "native-user",
                    },
                }},
        blocking=True,
    )

    assert calls[0].data == {
        "title": "Confirmation",
        "message": "Confirmed by user-1 (user-1)",
        "data": {
            "color": "#2DF56D", "tag": "water",
            "template_message": "Native metadata",
            "confirmation_device_id": "native-device",
            "confirmation_user_id": "native-user",
        },
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
        {"alert_id": "water", "action": "notify.mobile_app_phone", "payload": {}},
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
async def test_send_propagates_delivery_service_failure(
    hass: HomeAssistant, caplog: pytest.LogCaptureFixture,
) -> None:
    failure = HomeAssistantError("delivery failed")
    logger = "custom_components.ha_notifications.notification"
    caplog.set_level("DEBUG", logger=logger)
    payload = {"title": "Test title", "message": "Test message", "data": {"color": "#c7a600"}}
    await async_setup_services(hass)
    async_mock_service(hass, "notify", "mobile_app_phone", raise_exception=failure)
    with pytest.raises(HomeAssistantError, match="delivery failed") as raised:
        await hass.services.async_call(
            DOMAIN,
            "send",
            {"action": "notify.mobile_app_phone", "payload": payload},
            blocking=True,
        )
    assert raised.value is failure
    records = [record for record in caplog.records if record.name == logger]
    assert records[-1].getMessage().startswith("Notification send failed:")
    assert records[-1].args[-1] == payload
    assert records[-1].exc_info[1] is failure
    assert not any("completed:" in record.getMessage() for record in records)
