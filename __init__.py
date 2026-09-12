"""Notification Center integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    SOURCE_IMPORT,
)
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
)
from homeassistant.exceptions import (
    HomeAssistantError,
)

from .const import (
    DOMAIN,
    SERVICE_RELOAD,
    SERVICE_TEST,
)
from .panel import (
    async_register_frontend,
    async_unregister_frontend,
)
from .notifications import NotificationCenter
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
    """Get the running Notification Center."""

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
            "Notification Center is not configured."
        )

    return manager


async def async_setup(
    hass: HomeAssistant,
    config: dict[str, Any],
) -> bool:
    """Set up Notification Center."""

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
        """Reload Notification Center."""

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

    # ---------------------------------------------------------
    # Legacy YAML migration
    # ---------------------------------------------------------

    legacy_config = config.get(
        DOMAIN
    )

    existing_entries = (
        hass.config_entries.async_entries(
            DOMAIN
        )
    )

    if (
        isinstance(
            legacy_config,
            dict,
        )
        and legacy_config.get(
            "alerts"
        ) is not None
        and not existing_entries
    ):
        async def import_legacy() -> None:
            try:
                result = (
                    await hass.config_entries.flow.async_init(
                        DOMAIN,
                        context={
                            "source": SOURCE_IMPORT,
                        },
                        data=legacy_config,
                    )
                )

                if result.get(
                    "type"
                ) == "abort":
                    _LOGGER.warning(
                        "Notification Center YAML migration "
                        "did not create a config entry: %s",
                        result.get(
                            "reason"
                        ),
                    )

            except Exception:
                _LOGGER.exception(
                    "Failed to migrate legacy "
                    "Notification Center YAML"
                )

        hass.async_create_task(
            import_legacy()
        )

    return True


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Set up Notification Center from a config entry."""

    manager = NotificationCenter(
        hass
    )

    try:
        await manager.async_setup()

    except Exception:
        _LOGGER.exception(
            "Failed to set up Notification Center"
        )

        try:
            await manager.async_unload()
        except Exception:
            _LOGGER.exception(
                "Failed cleaning up Notification Center "
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
        hass
    )

    _LOGGER.info(
        "Notification Center started with %d alert(s)",
        len(manager.alerts),
    )

    return True


async def async_unload_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> bool:
    """Unload Notification Center."""

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
                "Failed to unload Notification Center"
            )
            unload_ok = False

    try:
        async_unregister_frontend(
            hass
        )
    except Exception:
        _LOGGER.exception(
            "Failed to unregister Notification Center frontend"
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