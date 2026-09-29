"""Tests for the Home Assistant config flow."""

from __future__ import annotations

import pytest

from custom_components.ha_notifications.config_flow import HaNotificationsConfigFlow


@pytest.mark.asyncio
async def test_user_flow_creates_empty_canonical_entry() -> None:
    flow = HaNotificationsConfigFlow()

    result = await flow.async_step_user({})

    assert result["type"] == "create_entry"
    assert result["title"] == "HA Notifications"
    assert result["data"] == {"version": 1, "alerts": []}