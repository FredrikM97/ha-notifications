"""Tests for the canonical notification service boundary."""

from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.service import async_get_all_descriptions
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)

from custom_components.ha_notifications.const import DOMAIN
from custom_components.ha_notifications.notification import (
    _parse_notification,
    async_setup_services,
)


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


@pytest.mark.asyncio
async def test_async_setup_services_registers_send_and_clear(
    hass: HomeAssistant,
) -> None:
    await async_setup_services(hass)
    assert hass.services.has_service(DOMAIN, "send")
    assert hass.services.has_service(DOMAIN, "clear")
    assert hass.services.has_service(DOMAIN, "record")
    assert hass.services.has_service(DOMAIN, "report")
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
    entry.runtime_data = type("RuntimeData", (), {"history": type(
        "History", (), {"async_record": AsyncMock()}
    )()})()
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
