"""Config flow for Notification Center."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries

from .const import DOMAIN


class NotificationCenterConfigFlow(
    config_entries.ConfigFlow,
    domain=DOMAIN,
):
    """Handle Notification Center config flow."""

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
                title="Notification Center",
                data={},
            )

        return self.async_show_form(
            step_id="user",
        )
