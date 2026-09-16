"""Shared pytest fixtures/helpers for the HA Notifications test suite.

Only holds helpers that are genuinely identical across files. Suite-specific
alert shapes (e.g. `test_controller_notifications.py`'s smaller alert, which
omits `monitor`/`conditions`/`enabled` on purpose) stay local rather than
being forced through here.
"""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_notifications.const import CONF_SHOW_SIDEBAR, DOMAIN


def make_alert(alert_id: str = "alert_1", **overrides: Any) -> dict[str, Any]:
    """Build a full alert dict for controller/alerts.py and controller/core.py tests."""

    base = {
        "id": alert_id,
        "name": "Test alert",
        "enabled": True,
        "conditions": [{"type": "template", "template": "{{ true }}"}],
        "monitor": {"on_change": True, "startup": True},
        "notification": {
            "target": {"entity_id": ["notify.test"]},
            "title": "Title",
            "message": "Message",
        },
        "confirmation": {"enabled": False},
    }
    base.update(overrides)
    return base


@pytest.fixture
def mock_config_entry() -> MockConfigEntry:
    """Return a minimal HA Notifications config entry."""
    return MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={CONF_SHOW_SIDEBAR: False},
    )


@pytest.fixture
async def loaded_config_entry(
    hass: HomeAssistant,
    mock_config_entry: MockConfigEntry,
) -> MockConfigEntry:
    """Load and settle a minimal HA Notifications config entry."""
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    return mock_config_entry
