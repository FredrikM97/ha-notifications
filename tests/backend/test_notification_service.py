"""Tests for the canonical notification service boundary."""

from copy import deepcopy

import pytest
import voluptuous as vol
from homeassistant.core import Context, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, Unauthorized
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.service import async_get_all_descriptions
from pytest_homeassistant.common import MockConfigEntry, async_mock_service
from syrupy.matchers import path_type

from custom_components.ha_notifications import RuntimeData
from custom_components.ha_notifications.automation import _SendComponent
from custom_components.ha_notifications.configuration import AlertConfig
from custom_components.ha_notifications.const import (
    COMMAND_CANCEL_RUN,
    CONFIG_ENTRY_MINOR_VERSION,
    CONFIG_ENTRY_VERSION,
    DOMAIN,
    EVENT_COMMAND,
)
from custom_components.ha_notifications.history import HistoryStore
from custom_components.ha_notifications.notification import (
    _parse_payload,
    _payload,
    async_setup_services,
)

_HISTORY_MATCHER = path_type(
    {r".*\.event\.event_id": (str,)},
    regex=True,
    replacer=lambda data, match: "<event-id>",
)


def test_native_payload_contract(snapshot) -> None:
    payloads = {
        "absent": {},
        "title-only": {"title": "Title only"},
        "subject-only": {"subject": "Native extra"},
        "empty-message": {"message": ""},
        "native-content": {
            "title": "Water",
            "message": "Low water",
            "custom": "value",
            "data": {
                "color": "#c7a600",
                "group": "water",
                "subject": "Details",
                "native_extra": {"priority": "high"},
            },
        },
        "device-content": {
            "title": "Canonical title",
            "message": "Canonical message",
            "data": {"title": "Device title", "message": "Device message"},
        },
        "native-metadata": {
            "data": {
                "template_message": "Native metadata",
                "confirmation_device_id": "native-device",
                "confirmation_user_id": "native-user",
                "alert_id": "native-alert",
                "history_reason": "native-reason",
            }
        },
    }
    originals = deepcopy(payloads)
    results = {}
    for name, payload in payloads.items():
        parsed = _parse_payload(payload)
        assert parsed is not payload
        assert parsed == payload
        results[name] = _payload(
            parsed, False, "alert" if name in {"empty-message", "native-content"} else None
        )
        if name in {"absent", "title-only", "subject-only"}:
            results[f"{name}-with-alert"] = _payload(parsed, False, "alert")
    for name, options in {"no-tag": {}, "explicit-tag": {"tag": "custom"}}.items():
        native = {"message": "Separate notification", "data": options}
        original = deepcopy(native)
        results[name] = {
            "send": _payload(native, False, "alert", False),
            "clear": _payload(native, True, "alert", False),
        }
        assert native == original
    assert payloads == originals
    assert results == snapshot


@pytest.mark.asyncio
@pytest.mark.parametrize("service", ["send", "clear"])
async def test_delivery_requires_native_payload(hass: HomeAssistant, service: str) -> None:
    await async_setup_services(hass)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    with pytest.raises(vol.Invalid):
        await hass.services.async_call(
            DOMAIN,
            service,
            {"action": "notify.mobile_app_phone", "data": {"message": "Not nested"}},
            blocking=True,
        )

    assert calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("service", "service_data"),
    [
        ("send", {"payload": {"message": "test"}, "action": "notify.test"}),
        ("clear", {"payload": {"message": "test"}, "action": "notify.test"}),
        ("report", {"alert_id": "test", "status": "started", "run_id": "test"}),
        ("command", {"alert_id": "test", "command": "cancel_run"}),
    ],
)
async def test_services_reject_non_admin_users(
    hass: HomeAssistant,
    hass_read_only_user,
    service: str,
    service_data: dict,
) -> None:
    await async_setup_services(hass)
    with pytest.raises(Unauthorized):
        await hass.services.async_call(
            DOMAIN,
            service,
            service_data,
            blocking=True,
            context=Context(user_id=hass_read_only_user.id),
        )


@pytest.mark.asyncio
async def test_service_manifest_passes_home_assistant_description_validation(
    hass: HomeAssistant,
    snapshot,
) -> None:
    await async_setup_services(hass)

    descriptions = await async_get_all_descriptions(hass)

    assert {
        "registered": sorted(hass.services.async_services()[DOMAIN]),
        "descriptions": descriptions[DOMAIN],
    } == snapshot


@pytest.mark.asyncio
async def test_action_executed_report_records_history_without_run_id(
    history_mock,
    hass: HomeAssistant,
    snapshot,
) -> None:
    await async_setup_services(hass)
    history = history_mock
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = RuntimeData(config=dict(entry.options), history=history)

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

    history.async_record.assert_awaited_once()
    assert {
        "args": history.async_record.await_args.args,
        "kwargs": history.async_record.await_args.kwargs,
    } == snapshot


@pytest.mark.asyncio
@pytest.mark.parametrize("command", ["skip_confirmation", COMMAND_CANCEL_RUN])
async def test_command_fires_alert_scoped_event(
    hass: HomeAssistant,
    command: str,
    snapshot,
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
    assert [
        {"event_type": event.event_type, "data": dict(event.data)} for event in events
    ] == snapshot


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("flow_key", "record_start"),
    [("flow_id", False), ("run_id", True)],
    ids=["explicit-flow", "started-run"],
)
async def test_inactive_reports_are_deduplicated_per_explicit_flow(
    hass: HomeAssistant,
    flow_key,
    record_start,
    freezer,
    snapshot,
) -> None:
    freezer.move_to("2026-11-05T12:00:00+00:00")
    await async_setup_services(hass)
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    history = HistoryStore(hass)
    entry.runtime_data = RuntimeData(config=dict(entry.options), history=history)
    events = []
    hass.bus.async_listen(EVENT_COMMAND, callback(lambda event: events.append(event)))
    clear_calls = async_mock_service(hass, DOMAIN, "clear")
    notification_calls = async_mock_service(hass, "notify", "mobile_app_phone")
    if record_start:
        await hass.services.async_call(
            DOMAIN,
            "report",
            {"alert_id": "door", "status": "started", flow_key: "run-1"},
            blocking=True,
        )
    for flow_id in ("run-1", "run-1", "run-2"):
        await hass.services.async_call(
            DOMAIN,
            "report",
            {"alert_id": "door", "status": "inactive", flow_key: flow_id},
            blocking=True,
        )

    entries = await history.async_entries("door")
    assert entries == snapshot(matcher=_HISTORY_MATCHER)
    assert sum(item["event"]["type"] == "inactive" for item in entries) == 2
    assert events == []
    assert clear_calls == []
    assert notification_calls == []


@pytest.mark.asyncio
async def test_send_resolves_explicit_notify_targets(
    history_mock,
    hass: HomeAssistant,
    snapshot,
) -> None:
    await async_setup_services(hass)
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = RuntimeData(config=dict(entry.options), history=history_mock)
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
    assert {
        "phone": [dict(call.data) for call in phone_calls],
        "tablet": [dict(call.data) for call in tablet_calls],
    } == snapshot


async def test_native_delivery_contract(
    hass: HomeAssistant,
    alert_factory,
    snapshot,
) -> None:
    options = {
        "group": "water",
        "channel": "Alerts",
        "push": {"sound": {"name": "default", "critical": 1, "volume": 1.0}},
        "ttl": 0,
        "priority": "high",
    }
    await async_setup_services(hass)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")
    results = {}
    for name, payload in {
        "absent-message": {},
        "title-only": {"title": "Title only"},
    }.items():
        await hass.services.async_call(
            DOMAIN,
            "send",
            {"action": "notify.mobile_app_phone", "payload": payload},
            blocking=True,
        )
        results[name] = [dict(call.data) for call in calls]
        calls.clear()
    variants = {
        "direct": options,
        "nested-data": {"data": options},
        "color": {
            "color": "#2DF56D",
            "persistent": True,
            "subject": "Motion details",
            "subtitle": "Backyard",
        },
    }
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
    )
    entry.add_to_hass(hass)
    for name, option_data in variants.items():
        stored = alert_factory(
            notification={
                "action": "notify.mobile_app_phone",
                "target": {"entity_id": ["notify.mobile_app_phone"]},
                "title": "Water",
                "message": "Low water",
                "options": option_data,
            }
        )
        alert = AlertConfig.model_validate(stored)
        before = alert.model_dump(mode="python")
        mapped = _SendComponent.notification_mapping(alert.notification)
        config = {"version": 1, "alerts": [stored]}
        entry.runtime_data = RuntimeData(config=config, history=HistoryStore(hass))
        await hass.services.async_call(
            DOMAIN,
            "send",
            {"alert_id": alert.id, **mapped},
            blocking=True,
        )
        results[name] = {"mapped": mapped, "delivered": [dict(call.data) for call in calls]}
        calls.clear()
        assert alert.model_dump(mode="python") == before
    assert results == snapshot


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "confirmation_enabled", [False, True], ids=["confirmation-off", "confirmation-on"]
)
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
    hass: HomeAssistant,
    alert_factory,
    platform_data: dict,
    confirmation_enabled: bool,
    snapshot,
    freezer,
) -> None:
    freezer.move_to("2026-11-05T12:00:00+00:00")
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
            "title": "Water",
            "message": "Low water",
            "options": mobile_data,
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

    await async_setup_services(hass)
    config = {"version": 1, "alerts": [stored]}
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        data=config,
    )
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
    assert {
        "mapped": notification,
        "delivered": [dict(call.data) for call in calls],
        "history": await history.async_entries(alert.id),
    } == snapshot(matcher=_HISTORY_MATCHER)
    delivered_data = calls[0].data["data"]
    assert delivered_data["custom"]["enabled"] is False
    assert type(delivered_data["custom"]["count"]) is int
    if "timeout" in platform_data:
        assert type(delivered_data["timeout"]) is int
        assert type(delivered_data["ttl"]) is int
        assert delivered_data["sticky"] is False
        assert delivered_data["alert_once"] is False
    if "push" in platform_data:
        assert type(delivered_data["push"]["badge"]) is int
        assert delivered_data["push"]["custom"]["enabled"] is False
    assert alert.model_dump(mode="python") == before
    assert stored["notification"]["options"] == mobile_data


@pytest.mark.asyncio
@pytest.mark.parametrize("service", ["send", "clear"])
async def test_managed_delivery_records_history_and_isolates_metadata(
    hass: HomeAssistant,
    history_mock,
    alert_factory,
    service: str,
    snapshot,
) -> None:
    stored = alert_factory(
        notification={
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.mobile_app_phone"]},
            "title": "Water",
            "message": "Low water",
            "options": {"priority": "high"},
        },
    )
    alert = AlertConfig.model_validate(stored)
    before = alert.model_dump(mode="python")
    mapped = _SendComponent.notification_mapping(alert.notification)

    await async_setup_services(hass)
    config = {"version": 1, "alerts": [stored]}
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        data=config,
    )
    entry.add_to_hass(hass)
    entry.runtime_data = RuntimeData(config=config, history=history_mock)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")

    scenarios = {
        "empty-payload": {
            "alert_id": "water",
            "action": "notify.mobile_app_phone",
            "payload": {},
            **({"alert_name": "Water alert", "flow_id": "flow-1"} if service == "send" else {}),
        },
        "integration-metadata": {
            "alert_id": alert.id,
            "alert_name": alert.name,
            "flow_id": "flow-1",
            "history_reason": "native_boundary",
            "confirmation": {"user_id": "test-user"},
            **mapped,
        },
    }
    results = {}
    for name, service_data in scenarios.items():
        calls.clear()
        history_mock.reset_mock()
        original = deepcopy(service_data)
        await hass.services.async_call(DOMAIN, service, service_data, blocking=True)

        assert len(calls) == 1
        history_mock.async_record.assert_awaited_once()
        results[name] = {
            "delivered": [dict(call.data) for call in calls],
            "history_args": history_mock.async_record.await_args.args,
            "history_kwargs": history_mock.async_record.await_args.kwargs,
        }
        assert service_data == original
    assert results == snapshot
    assert alert.model_dump(mode="python") == before


@pytest.mark.asyncio
async def test_send_preserves_dynamic_target_selectors(
    hass: HomeAssistant,
    snapshot,
) -> None:
    await async_setup_services(hass)
    area = ar.async_get(hass).async_create("Kitchen")
    mobile_entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
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

    assert [dict(call.data) for call in calls] == snapshot


@pytest.mark.asyncio
@pytest.mark.parametrize("service", ["send", "clear"])
async def test_delivery_debug_log_matches_notify_payload(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
    service: str,
    snapshot,
) -> None:
    await async_setup_services(hass)
    calls = async_mock_service(hass, "notify", "mobile_app_phone")
    logger = "custom_components.ha_notifications.notification"
    caplog.set_level("DEBUG", logger=logger)

    await hass.services.async_call(
        DOMAIN,
        service,
        {
            "action": "notify.mobile_app_phone",
            "payload": {
                "message": "Debug notification",
                "data": {"priority": "high", "ttl": 0, "actions": []},
            },
        },
        blocking=True,
    )

    records = [record for record in caplog.records if record.name == logger]
    assert len(calls) == 1
    assert records[0].args[-1] == calls[0].data
    assert [record.getMessage() for record in records] == snapshot


@pytest.mark.asyncio
@pytest.mark.parametrize("recipient", ["device", "person", "authenticated-user", "unresolved"])
async def test_report_resolves_confirmation_identity(
    history_mock,
    hass: HomeAssistant,
    recipient,
    snapshot,
) -> None:
    await async_setup_services(hass)
    history = history_mock
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = RuntimeData(config=dict(entry.options), history=history)
    details = {"device_id": "missing-device"}
    if recipient == "device":
        mobile_entry = MockConfigEntry(
            version=CONFIG_ENTRY_VERSION,
            minor_version=CONFIG_ENTRY_MINOR_VERSION,
            domain="mobile_app",
            title="Phone",
        )
        mobile_entry.add_to_hass(hass)
        device = dr.async_get(hass).async_get_or_create(
            config_entry_id=mobile_entry.entry_id,
            identifiers={("mobile_app", "phone")},
        )
        dr.async_get(hass).async_update_device(device.id, name_by_user="Living Room Phone")
        details = {"device_id": device.id, "user_id": "user-1"}
    elif recipient == "person":
        hass.states.async_set(
            "person.alice", "Alice", {"user_id": "user-1", "friendly_name": "Alice"}
        )
        details = {"user_id": "user-1"}
    elif recipient == "authenticated-user":
        user = await hass.auth.async_create_user("Authenticated Alice")
        details["user_id"] = user.id

    await hass.services.async_call(
        DOMAIN,
        "report",
        {
            "alert_id": "water",
            "status": "confirmation_completed",
            "run_id": "run-1",
            "details": details,
        },
        blocking=True,
    )

    history.async_record.assert_awaited_once()
    assert {
        "args": history.async_record.await_args.args,
        "kwargs": history.async_record.await_args.kwargs,
    } == snapshot


@pytest.mark.asyncio
async def test_send_renders_deferred_confirmation_message(
    history_mock,
    hass: HomeAssistant,
    snapshot,
) -> None:
    await async_setup_services(hass)
    history = history_mock
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = RuntimeData(config=dict(entry.options), history=history)
    mobile_entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain="mobile_app",
        title="Phone",
    )
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
            "confirmation": {"device_id": device.id, "user_id": "user-1"},
            "action": "notify.mobile_app_phone",
            "payload": {
                "title": "Confirmation",
                "message": ("Confirmed by {{confirmed_by}} ({{user_id}})"),
                "data": {
                    "color": "#2DF56D",
                    "template_message": "Native metadata",
                    "confirmation_device_id": "native-device",
                    "confirmation_user_id": "native-user",
                },
            },
        },
        blocking=True,
    )

    assert [dict(call.data) for call in calls] == snapshot


@pytest.mark.asyncio
async def test_send_propagates_delivery_service_failure(
    hass: HomeAssistant,
    caplog: pytest.LogCaptureFixture,
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
