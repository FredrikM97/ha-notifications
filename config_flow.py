"""Config flow for Notification Center."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries

from .const import DOMAIN
from .models import normalize_config
from .storage import NotificationStorage


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

    async def async_step_import(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> config_entries.ConfigFlowResult:
        """Import the previous YAML configuration."""

        if self.hass.config_entries.async_entries(DOMAIN):
            return self.async_abort(
                reason="already_configured"
            )

        if user_input:
            normalized = normalize_config(
                user_input
            )

            storage = NotificationStorage(
                self.hass
            )

            await storage.async_save_config(
                normalized
            )

        return self.async_create_entry(
            title="Notification Center",
            data={},
        )