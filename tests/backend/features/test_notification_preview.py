"""Tests for the stateless notification preview trigger."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.ha_notifications.const import EVENT_NOTIFICATION_ACTION


@pytest.mark.asyncio
@pytest.mark.usefixtures("enable_custom_integrations")
async def test_preview_forwards_a_forced_condition_result(
    hass: HomeAssistant,
    loaded_config_entry,
    notification_alert_factory,
):
    calls = async_mock_service(hass, "notify", "send_message")
    controller = loaded_config_entry.runtime_data
    alert = notification_alert_factory("preview_forced_condition")

    result = await controller.dispatch("notification_preview.payload", alert)

    assert result is True
    await hass.async_block_till_done()
    assert len(calls) == 1
    assert calls[0].data["message"] == alert["notification"]["message"]


@pytest.mark.asyncio
@pytest.mark.usefixtures("enable_custom_integrations")
async def test_preview_runtime_is_available_for_active_view(
    loaded_config_entry,
    notification_alert_factory,
):
    controller = loaded_config_entry.runtime_data
    alert = notification_alert_factory("preview_runtime")

    await controller.dispatch("notification_preview.payload", alert)

    previews = await controller.dispatch("notification_preview.runtime_mapping")

    assert len(previews) == 1
    assert previews[0]["alert"]["id"].startswith("NC_PREVIEW_")
    assert previews[0]["runtime"]["state"]["active"] is True


@pytest.mark.asyncio
@pytest.mark.usefixtures("enable_custom_integrations")
async def test_confirmed_preview_runtime_is_removed_from_active_view(
    hass: HomeAssistant,
    loaded_config_entry,
    confirmation_alert_factory,
):
    controller = loaded_config_entry.runtime_data
    alert = confirmation_alert_factory("preview_confirmation")

    await controller.dispatch("notification_preview.payload", alert)
    previews = await controller.dispatch("notification_preview.runtime_mapping")
    pending = next(
        item for item in previews[0]["runtime"]["trace"] if "action_ids" in item
    )
    action_id = next(iter(pending["action_ids"]))

    hass.bus.async_fire(EVENT_NOTIFICATION_ACTION, {"action": action_id})
    await hass.async_block_till_done()

    assert await controller.dispatch("notification_preview.runtime_mapping") == []


@pytest.mark.asyncio
@pytest.mark.usefixtures("enable_custom_integrations")
async def test_preview_validates_payload_before_triggering(
    loaded_config_entry,
):
    controller = loaded_config_entry.runtime_data

    with pytest.raises(ValueError):
        await controller.dispatch("notification_preview.payload", {"invalid": True})
