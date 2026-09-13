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
from .notifications import NotificationCenter
from .panel import (
    async_register_frontend,
    async_unregister_frontend,
)
from .websocket import async_setup as async_setup_websocket

_LOGGER = logging.getLogger(__name__)

SERVICE_TEST_SCHEMA = vol.Schema(
    {
        vol.Required("alert_id"): str,
    }
)


def _get_manager(
    hass: HomeAssistant,
) -> NotificationCenter:
    """Get the running HA Notifications manager."""

    data = hass.data.get(
        DOMAIN,
        {},
    )

    manager = (
        data.get("manager")
        if isinstance(
            data,
            dict,
        )
        else None
    )

    if not isinstance(
        manager,
        NotificationCenter,
    ):
        raise HomeAssistantError(
            "HA Notifications is not configured."
        )

    return manager


async def async_setup(
    hass: HomeAssistant,
    config: dict[str, Any],
) -> bool:
    """Set up HA Notifications."""

    hass.data.setdefault(
        DOMAIN,
        {},
    )

    # WebSocket API exists even before the config entry
    # is loaded. Calls simply fail cleanly until it is.
    await async_setup_websocket(
        hass
    )

    async def handle_reload(
        _call: ServiceCall,
    ) -> None:
        """Reload HA Notifications."""

        await _get_manager(
            hass
        ).async_reload()

    async def handle_test(
        call: ServiceCall,
    ) -> None:
        """Test an alert."""

        await _get_manager(
            hass
        ).async_test_alert(
            call.data["alert_id"]
        )

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

    manager = NotificationCenter(
        hass
    )

    try:
        await manager.async_setup()

    except Exception:
        _LOGGER.exception(
            "Failed to set up HA Notifications"
        )

        try:
            await manager.async_unload()
        except Exception:
            _LOGGER.exception(
                "Failed cleaning up HA Notifications "
                "after setup failure"
            )

        raise

    data = hass.data.setdefault(
        DOMAIN,
        {},
    )

    data["manager"] = manager

    # ConfigEntry runtime_data is the authoritative runtime
    # location.
    entry.runtime_data = manager

    await async_register_frontend(
        hass,
        show_in_sidebar=entry.data.get(
            CONF_SHOW_SIDEBAR,
            True,
        ),
    )

    _LOGGER.info(
        "HA Notifications started with %d alert(s)",
        len(manager.alerts),
    )

    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Unload HA Notifications."""

    manager = entry.runtime_data

    if not isinstance(
        manager,
        NotificationCenter,
    ):
        manager = None

    unload_ok = True

    if manager is not None:
        try:
            unload_ok = (
                await manager.async_unload()
            )
        except Exception:
            _LOGGER.exception(
                "Failed to unload HA Notifications"
            )
            unload_ok = False

    try:
        async_unregister_frontend(
            hass
        )
    except Exception:
        _LOGGER.exception(
            "Failed to unregister HA Notifications frontend"
        )
        unload_ok = False

    data = hass.data.get(
        DOMAIN
    )

    if isinstance(
        data,
        dict,
    ):
        data.pop(
            "manager",
            None,
        )

    return unload_ok