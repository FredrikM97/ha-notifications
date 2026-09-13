"""Notification Center WebSocket API."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN


def _manager(hass: HomeAssistant):
    """Get the Notification Center manager."""

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

    if manager is None:
        raise RuntimeError(
            "Notification Center is not loaded."
        )

    return manager


async def async_setup(
    hass: HomeAssistant,
) -> None:
    """Register WebSocket commands."""

    @websocket_api.websocket_command(
        {
            vol.Required("type"):
                f"{DOMAIN}/list",
        }
    )
    @websocket_api.async_response
    async def handle_list(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Return all alerts."""

        result = await _manager(
            hass
        ).async_list_alerts()

        connection.send_result(
            msg["id"],
            result,
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"):
                f"{DOMAIN}/save",
            vol.Required("alert"):
                dict,
        }
    )
    @websocket_api.async_response
    async def handle_save(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Create/update an alert."""

        try:
            result = await _manager(
                hass
            ).async_save_alert(
                msg["alert"]
            )
        except Exception as err:
            connection.send_error(
                msg["id"],
                "save_failed",
                str(err) or "Unable to save alert.",
            )
            return

        connection.send_result(
            msg["id"],
            result,
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"):
                f"{DOMAIN}/delete",
            vol.Required("alert_id"):
                str,
        }
    )
    @websocket_api.async_response
    async def handle_delete(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Delete an alert."""

        await _manager(
            hass
        ).async_delete_alert(
            msg["alert_id"]
        )

        connection.send_result(
            msg["id"],
            True,
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"):
                f"{DOMAIN}/test",
            vol.Required("alert_id"):
                str,
        }
    )
    @websocket_api.async_response
    async def handle_test(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Test an alert."""

        try:
            await _manager(
                hass
            ).async_test_alert(
                msg["alert_id"]
            )
        except Exception as err:
            connection.send_error(
                msg["id"],
                "test_failed",
                str(err) or "Unable to send test notification.",
            )
            return

        connection.send_result(
            msg["id"],
            True,
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"):
                f"{DOMAIN}/history",
            vol.Optional(
                "alert_id"
            ): str,
            vol.Optional(
                "limit",
                default=100,
            ): vol.All(
                vol.Coerce(int),
                vol.Range(
                    min=1,
                    max=500,
                ),
            ),
        }
    )
    @websocket_api.async_response
    async def handle_history(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Return history."""

        result = await _manager(
            hass
        ).async_history(
            msg.get(
                "alert_id"
            ),
            msg["limit"],
        )

        connection.send_result(
            msg["id"],
            result,
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"):
                f"{DOMAIN}/get_yaml",
        }
    )
    @websocket_api.async_response
    async def handle_get_yaml(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Return YAML."""

        result = await _manager(
            hass
        ).async_get_yaml()

        connection.send_result(
            msg["id"],
            {
                "yaml": result,
            },
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"):
                f"{DOMAIN}/validate_yaml",
            vol.Required("yaml"):
                str,
        }
    )
    @websocket_api.async_response
    async def handle_validate_yaml(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Validate YAML without writing it."""

        await _manager(
            hass
        ).async_validate_yaml(
            msg["yaml"]
        )

        connection.send_result(
            msg["id"],
            True,
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"):
                f"{DOMAIN}/save_yaml",
            vol.Required("yaml"):
                str,
        }
    )
    @websocket_api.async_response
    async def handle_save_yaml(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Save YAML."""

        await _manager(
            hass
        ).async_save_yaml(
            msg["yaml"]
        )

        connection.send_result(
            msg["id"],
            True,
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"):
                f"{DOMAIN}/reload",
        }
    )
    @websocket_api.async_response
    async def handle_reload(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Reload YAML configuration."""

        await _manager(
            hass
        ).async_reload()

        connection.send_result(
            msg["id"],
            True,
        )

    websocket_api.async_register_command(
        hass,
        handle_list,
    )

    websocket_api.async_register_command(
        hass,        handle_validate_yaml,
    )

    websocket_api.async_register_command(
        hass,        handle_save,
    )

    websocket_api.async_register_command(
        hass,
        handle_delete,
    )

    websocket_api.async_register_command(
        hass,
        handle_test,
    )

    websocket_api.async_register_command(
        hass,
        handle_history,
    )

    websocket_api.async_register_command(
        hass,
        handle_get_yaml,
    )

    websocket_api.async_register_command(
        hass,
        handle_save_yaml,
    )

    websocket_api.async_register_command(
        hass,
        handle_reload,
    )