"""Tests for the Home Assistant config flow."""

from pathlib import Path

import pytest

from custom_components.ha_notifications.config_flow import HaNotificationsConfigFlow
from custom_components.ha_notifications.const import DOMAIN
from tests.backend.conftest import MockConfigEntry


def test_entry_has_no_options_flow_that_could_overwrite_alerts() -> None:
    entry = MockConfigEntry(domain=DOMAIN, options={"version": 1, "alerts": []})

    assert not HaNotificationsConfigFlow.async_supports_options_flow(entry)


@pytest.mark.asyncio
async def test_user_flow_does_not_modify_configuration_yaml(hass) -> None:
    configuration_path = Path(hass.config.path("configuration.yaml"))
    configuration_path.write_text("logger:\n  default: warning\n")
    original = configuration_path.read_text()
    flow = HaNotificationsConfigFlow()
    flow.hass = hass

    result = await flow.async_step_user()
    assert result["type"] == "form"

    created = await flow.async_step_user(user_input={})
    assert created["type"] == "create_entry"
    assert created["data"] == {}
    assert created["options"] == {"version": 1, "alerts": []}
    assert configuration_path.read_text() == original
