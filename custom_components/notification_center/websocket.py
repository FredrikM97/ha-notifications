"""HA Notifications WebSocket API."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN


def _manager(hass: HomeAssistant):
    """Get the HA Notifications manager."""

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
            "HA Notifications is not loaded."
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
                f"{DOMAIN}/test_payload",
            vol.Required("alert"):
                dict,
        }
    )
    @websocket_api.async_response
    async def handle_test_payload(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Send a non-persisting test for the editor's current payload."""

        try:
            result = await _manager(
                hass
            ).async_test_alert_payload(
                msg["alert"]
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
            result,
        )

    @websocket_api.websocket_command(
        {
            vol.Required("type"):
                f"{DOMAIN}/discard_test_payload",
            vol.Required("session_id"): str,
        }
    )
    @websocket_api.async_response
    async def handle_discard_test_payload(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Discard temporary confirmation actions for an editor draft test."""

        await _manager(hass).async_discard_draft_test(msg["session_id"])

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
                f"{DOMAIN}/validate_conditions",
            vol.Required("alert"):
                dict,
        }
    )
    @websocket_api.async_response
    async def handle_validate_conditions(
        _hass: HomeAssistant,
        connection,
        msg: dict[str, Any],
    ) -> None:
        """Validate alert conditions without writing or notifying."""

        try:
            await _manager(
                hass
            ).async_validate_conditions(
                msg["alert"]
            )
        except Exception as err:
            connection.send_error(
                msg["id"],
                "condition_invalid",
                str(err) or "Condition is invalid.",
            )
            return

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

        result = await _manager(
            hass
        ).async_save_yaml(
            msg["yaml"]
        )

        connection.send_result(
            msg["id"],
            {
                "saved": True,
                "config": result,
            },
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

    for handler in (
        handle_list,
        handle_validate_yaml,
        handle_validate_conditions,
        handle_save,
        handle_delete,
        handle_test,
        handle_test_payload,
        handle_discard_test_payload,
        handle_history,
        handle_get_yaml,
        handle_save_yaml,
        handle_reload,
    ):
        websocket_api.async_register_command(hass, handler)