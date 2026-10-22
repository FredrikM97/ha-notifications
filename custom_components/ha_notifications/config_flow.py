"""Config flow for HA Notifications."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries

from .configuration import empty_config
from .const import CONFIG_ENTRY_MINOR_VERSION, CONFIG_ENTRY_VERSION, DOMAIN


class HaNotificationsConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create the canonical config-entry source of truth."""

    VERSION = CONFIG_ENTRY_VERSION
    MINOR_VERSION = CONFIG_ENTRY_MINOR_VERSION

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Create an empty alert configuration."""
        if user_input is not None:
            return self.async_create_entry(
                title="HA Notifications",
                data={},
                options=empty_config(),
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({}),
        )
