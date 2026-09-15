"""HA Notifications integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import (
    ConfigEntry,
)
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
)
from homeassistant.exceptions import (
    HomeAssistantError,
)

from .const import (
    CONF_SHOW_SIDEBAR,
    DOMAIN,
    SERVICE_RELOAD,
    SERVICE_TEST,
)
from .controller.core import HaNotificationsController
from .controller.lifecycle import FeatureLifecycle

_LOGGER = logging.getLogger(__name__)

SERVICE_TEST_SCHEMA = vol.Schema(
    {
        vol.Required("alert_id"): str,
    }
)


def _get_controller(
    hass: HomeAssistant,
) -> HaNotificationsController:
    """Get the running controller."""

    for entry in hass.config_entries.async_entries(DOMAIN):
        controller = entry.runtime_data
        if isinstance(controller, HaNotificationsController):
            return controller

    raise HomeAssistantError("HA Notifications is not configured.")


async def async_setup(
    hass: HomeAssistant,
    config: dict[str, Any],
) -> bool:
    """Set up HA Notifications."""

    async def handle_reload(
        _call: ServiceCall,
    ) -> None:
        """Reload HA Notifications."""

        await _get_controller(hass).reload()

    async def handle_test(
        call: ServiceCall,
    ) -> None:
        """Test an alert."""

        await _get_controller(hass).dispatch("testing.saved", call.data["alert_id"])

    if not hass.services.has_service(
        DOMAIN,
        SERVICE_RELOAD,
    ):
        hass.services.async_register(
            DOMAIN,
            SERVICE_RELOAD,
            handle_reload,
        )

    if not hass.services.has_service(
        DOMAIN,
        SERVICE_TEST,
    ):
        hass.services.async_register(
            DOMAIN,
            SERVICE_TEST,
            handle_test,
            schema=SERVICE_TEST_SCHEMA,
        )

    return True


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Set up HA Notifications from a config entry."""

    controller = HaNotificationsController(hass)
    controller.attach_feature_lifecycle(
        await FeatureLifecycle.async_create(
            controller.feature_services, controller.reload
        )
    )

    try:
        await controller.async_setup(
            show_in_sidebar=entry.data.get(
                CONF_SHOW_SIDEBAR,
                True,
            ),
        )

    except Exception:
        _LOGGER.exception("Failed to set up HA Notifications")

        try:
            await controller.async_unload()
        except Exception:
            _LOGGER.exception("Failed cleaning up HA Notifications after setup failure")

        raise

    entry.runtime_data = controller

    _LOGGER.info("HA Notifications started")

    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Unload HA Notifications."""

    controller = entry.runtime_data

    if not isinstance(
        controller,
        HaNotificationsController,
    ):
        controller = None

    unload_ok = True

    if controller is not None:
        try:
            unload_ok = await controller.async_unload()
        except Exception:
            _LOGGER.exception("Failed to unload HA Notifications")
            unload_ok = False

    return unload_ok


async def async_remove_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> None:
    """Clean up integration-owned runtime state after entry removal."""

    controller = entry.runtime_data

    if isinstance(controller, HaNotificationsController):
        await controller.async_remove()

    if hass.services.has_service(DOMAIN, SERVICE_RELOAD):
        hass.services.async_remove(DOMAIN, SERVICE_RELOAD)
    if hass.services.has_service(DOMAIN, SERVICE_TEST):
        hass.services.async_remove(DOMAIN, SERVICE_TEST)
