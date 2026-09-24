"""Tests for the stateless notification preview trigger."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import async_mock_service


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
async def test_preview_validates_payload_before_triggering(
    loaded_config_entry,
):
    controller = loaded_config_entry.runtime_data

    with pytest.raises(ValueError):
        await controller.dispatch("notification_preview.payload", {"invalid": True})
