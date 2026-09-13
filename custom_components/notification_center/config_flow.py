"""Config flow for HA Notifications."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries

from .const import CONF_SHOW_SIDEBAR, DOMAIN


class NotificationCenterConfigFlow(
    config_entries.ConfigFlow,
    domain=DOMAIN,
):
    """Handle HA Notifications config flow."""

    VERSION = 1
    MINOR_VERSION = 0

    async def async_step_user(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> config_entries.ConfigFlowResult:
        """Handle installation from the UI."""

        if self.hass.config_entries.async_entries(DOMAIN):
            return self.async_abort(
                reason="already_configured"
            )

        if user_input is not None:
            return self.async_create_entry(
                title="HA Notifications",
                data={
                    CONF_SHOW_SIDEBAR: user_input[CONF_SHOW_SIDEBAR],
                },
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SHOW_SIDEBAR,
                        default=False,
                    ): bool,
                }
            ),
        )
