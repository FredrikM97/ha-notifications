"""The only frontend-facing interface: registers the 12 websocket commands.

Every handler does exactly: parse `msg` -> validate (if it carries an
alert/YAML payload) -> call the matching `controller/core.py` method ->
return the result. HA's command-name-based dispatch is the router; no
separate dispatch table is introduced here.
"""

from __future__ import annotations

from typing import Any, Callable

import voluptuous as vol
from homeassistant.components import websocket_api

from ..const import DOMAIN
from . import validation


def register(controller: Any, register_command: Callable[[Any], None]) -> None:
    """Register the 12 `notification_center/*` websocket commands.

    ``register_command`` is `ha/gateway.py`'s `register_websocket_command` -
    this module never imports `ha.gateway` itself.
    """

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/list"})
    @websocket_api.async_response
    async def handle_list(_hass, connection, msg: dict[str, Any]) -> None:
        connection.send_result(msg["id"], await controller.list_alerts())

    @websocket_api.websocket_command(
        {vol.Required("type"): f"{DOMAIN}/save", vol.Required("alert"): dict}
    )
    @websocket_api.async_response
    async def handle_save(_hass, connection, msg: dict[str, Any]) -> None:
        try:
            normalized = validation.normalize_alert(msg["alert"])
            result = await controller.save_alert(normalized)
        except Exception as err:
            connection.send_error(
                msg["id"], "save_failed", str(err) or "Unable to save alert."
            )
            return
        connection.send_result(msg["id"], result)

    @websocket_api.websocket_command(
        {vol.Required("type"): f"{DOMAIN}/delete", vol.Required("alert_id"): str}
    )
    @websocket_api.async_response
    async def handle_delete(_hass, connection, msg: dict[str, Any]) -> None:
        await controller.delete_alert(msg["alert_id"])
        connection.send_result(msg["id"], True)

    @websocket_api.websocket_command(
        {vol.Required("type"): f"{DOMAIN}/test", vol.Required("alert_id"): str}
    )
    @websocket_api.async_response
    async def handle_test(_hass, connection, msg: dict[str, Any]) -> None:
        try:
            await controller.test_alert(msg["alert_id"])
        except Exception as err:
            connection.send_error(
                msg["id"],
                "test_failed",
                str(err) or "Unable to send test notification.",
            )
            return
        connection.send_result(msg["id"], True)

    @websocket_api.websocket_command(
        {vol.Required("type"): f"{DOMAIN}/test_payload", vol.Required("alert"): dict}
    )
    @websocket_api.async_response
    async def handle_test_payload(_hass, connection, msg: dict[str, Any]) -> None:
        try:
            normalized = validation.normalize_alert(msg["alert"])
            result = await controller.test_alert_payload(normalized)
        except Exception as err:
            connection.send_error(
                msg["id"],
                "test_failed",
                str(err) or "Unable to send test notification.",
            )
            return
        connection.send_result(msg["id"], result)

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/discard_test_payload",
            vol.Required("session_id"): str,
        }
    )
    @websocket_api.async_response
    async def handle_discard_test_payload(
        _hass, connection, msg: dict[str, Any]
    ) -> None:
        await controller.discard_test_payload(msg["session_id"])
        connection.send_result(msg["id"], True)

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/history",
            vol.Optional("alert_id"): str,
            vol.Optional("limit", default=100): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=500)
            ),
        }
    )
    @websocket_api.async_response
    async def handle_history(_hass, connection, msg: dict[str, Any]) -> None:
        result = await controller.get_history(msg.get("alert_id"), msg["limit"])
        connection.send_result(msg["id"], result)

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/get_yaml"})
    @websocket_api.async_response
    async def handle_get_yaml(_hass, connection, msg: dict[str, Any]) -> None:
        result = await controller.get_yaml()
        connection.send_result(msg["id"], {"yaml": result})

    @websocket_api.websocket_command(
        {vol.Required("type"): f"{DOMAIN}/validate_yaml", vol.Required("yaml"): str}
    )
    @websocket_api.async_response
    async def handle_validate_yaml(_hass, connection, msg: dict[str, Any]) -> None:
        await controller.validate_yaml(msg["yaml"])
        connection.send_result(msg["id"], True)

    @websocket_api.websocket_command(
        {
            vol.Required("type"): f"{DOMAIN}/validate_conditions",
            vol.Required("alert"): dict,
        }
    )
    @websocket_api.async_response
    async def handle_validate_conditions(
        _hass, connection, msg: dict[str, Any]
    ) -> None:
        try:
            normalized = validation.normalize_alert(msg["alert"])
            await controller.validate_conditions(normalized)
        except Exception as err:
            connection.send_error(
                msg["id"], "condition_invalid", str(err) or "Condition is invalid."
            )
            return
        connection.send_result(msg["id"], True)

    @websocket_api.websocket_command(
        {vol.Required("type"): f"{DOMAIN}/save_yaml", vol.Required("yaml"): str}
    )
    @websocket_api.async_response
    async def handle_save_yaml(_hass, connection, msg: dict[str, Any]) -> None:
        result = await controller.save_yaml(msg["yaml"])
        connection.send_result(msg["id"], {"saved": True, "config": result})

    @websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/reload"})
    @websocket_api.async_response
    async def handle_reload(_hass, connection, msg: dict[str, Any]) -> None:
        await controller.reload()
        connection.send_result(msg["id"], True)

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
        register_command(handler)
