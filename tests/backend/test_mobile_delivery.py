"""Generated alerts delivered to registry-resolved Mobile App notify services."""

from copy import deepcopy
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry
from homeassistant.setup import async_setup_component

from custom_components import ha_notifications
from custom_components.ha_notifications.automation import automation_id
from custom_components.ha_notifications.const import DOMAIN
from tests.backend.conftest import MockConfigEntry, async_mock_service


@pytest.fixture(
    params=[("Android", "Samsung", "16"), ("iOS", "Apple", "26")],
    ids=["android", "ios"],
)
async def notify_phone(hass: HomeAssistant, request: pytest.FixtureRequest):
    os_name, manufacturer, os_version = request.param
    user = await hass.auth.async_create_user("Notify test user", local_only=True)
    entry = MockConfigEntry(
        domain="mobile_app",
        title="Test Phone",
        data={
            "app_id": "io.homeassistant.test",
            "app_version": "2026.10",
            "device_id": "test-phone",
            "device_name": "Test Phone",
            "manufacturer": manufacturer,
            "model": "Test Phone",
            "os_name": os_name,
            "os_version": os_version,
            "supports_encryption": False,
            "user_id": user.id,
            "webhook_id": "test-phone-webhook",
        },
    )
    entry.add_to_hass(hass)
    device = device_registry.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={("mobile_app", entry.entry_id)},
        name="Test Phone",
        manufacturer=manufacturer,
        model="Test Phone",
        sw_version=os_version,
    )
    calls = async_mock_service(hass, "notify", "mobile_app_test_phone")
    return device, calls


@pytest.mark.parametrize("use_default_tag", [True, False], ids=["default-tag", "no-default-tag"])
@pytest.mark.parametrize("custom_tag", [None, "custom-tag"], ids=["no-custom-tag", "custom-tag"])
async def test_generated_alert_reaches_mobile_notify_service(
    hass: HomeAssistant,
    notify_phone,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
    snapshot,
    use_default_tag,
    custom_tag,
) -> None:
    monkeypatch.setattr(ha_notifications, "async_register_panel", AsyncMock())
    device, calls = notify_phone
    device_data = {
        "color": "#c7a600",
        "group": "derp",
        "ledColor": "#d8a22c",
        "persistent": True,
        "sticky": True,
        "subject": "bla bla bla",
        "actions": [{"action": "confirm-test", "title": "Done"}],
        "timeout": 900,
    }
    if custom_tag is not None:
        device_data["tag"] = custom_tag
    if not use_default_tag and custom_tag is None:
        del device_data["persistent"]
    notification = {
        "target": {"device_id": [device.id]},
        "title": "TEst text test",
        "message": "testtest",
        "use_default_tag": use_default_tag,
        "options": device_data,
    }
    original = deepcopy(notification)
    alert = alert_factory(notification=notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    automation = next(
        state for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(alert)
    )

    await hass.services.async_call(
        "automation", "trigger",
        {"entity_id": automation.entity_id, "skip_condition": True},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert len(calls) == 1
    sent = dict(calls[0].data)
    assert sent["message"] == "testtest"
    assert sent["title"] == "TEst text test"
    expected_tag = custom_tag or (alert["id"] if use_default_tag else None)
    assert sent["data"] == {
        **device_data, **({"tag": expected_tag} if expected_tag is not None else {}),
    }
    assert "use_default_tag" not in sent
    assert "use_default_tag" not in sent["data"]
    assert "message" not in sent["data"]
    assert "title" not in sent["data"]
    assert notification == original

    await hass.services.async_call(
        DOMAIN, "clear",
        {
            "alert_id": alert["id"],
            "use_default_tag": use_default_tag,
            "target": notification["target"],
            "payload": {
                "title": notification["title"],
                "message": notification["message"],
                "data": notification["options"],
            },
        },
        blocking=True,
    )
    assert len(calls) == 2
    cleared = dict(calls[1].data)
    assert cleared["message"] == "clear_notification"
    assert cleared["data"] == sent["data"]
    if expected_tag is None:
        assert "tag" not in sent["data"]
        assert "tag" not in cleared["data"]
    assert notification == original
    assert {"sent": sent, "cleared": cleared} == snapshot