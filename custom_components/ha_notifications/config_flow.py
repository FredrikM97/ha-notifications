"""Config flow for HA Notifications."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries
from homeassistant.core import callback

from .const import CONFIG_VERSION, DOMAIN


class HaNotificationsConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Create the canonical config-entry source of truth."""

    VERSION = CONFIG_VERSION

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Create an empty alert configuration."""
        if user_input is not None:
            return self.async_create_entry(
                title="HA Notifications",
                data={"version": CONFIG_VERSION, "alerts": []},
            )

        return self.async_show_form(step_id="user")

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Return the options flow used by Home Assistant."""
        return HaNotificationsOptionsFlow()


class HaNotificationsOptionsFlow(config_entries.OptionsFlow):
    """Persist configuration updates in config-entry options."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Keep options changes available to the frontend/API boundary."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        return self.async_show_form(step_id="init")