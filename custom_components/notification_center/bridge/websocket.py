"""The only frontend-facing interface: registers the 12 websocket commands.

Feature routes declare their public command metadata. This module turns those
declarations into Home Assistant websocket handlers and retains legacy
controller commands while their owning features are migrated.
"""

from __future__ import annotations

from typing import Any, Callable

import voluptuous as vol
from homeassistant.components import websocket_api

from ..const import DOMAIN
from ..controller.lifecycle import FeatureLifecycle, WebsocketRoute


def register(
    lifecycle: FeatureLifecycle,
    register_command: Callable[[Any], None],
) -> None:
    """Register the feature-declared `notification_center/*` websocket commands.

    ``register_command`` is `ha/gateway.py`'s `register_websocket_command` -
    this module never imports `ha.gateway` itself.
    """

    def feature_handler(specification: WebsocketRoute) -> Any:
        schema = {vol.Required("type"): f"{DOMAIN}/{specification.command}"}
        for argument in specification.arguments:
            field = vol.Required(argument.name)
            if not argument.required:
                field = vol.Optional(argument.name, default=argument.default)
            validator = argument.validator
            if not argument.required and argument.default is None:
                validator = vol.Any(validator, None)
            schema[field] = validator

        @websocket_api.websocket_command(schema)
        @websocket_api.async_response
        async def handle(_hass, connection, msg: dict[str, Any]) -> None:
            try:
                arguments = {
                    argument.name: msg[argument.name]
                    for argument in specification.arguments
                }
                result = await lifecycle.dispatch(specification.name, **arguments)
            except Exception as err:
                connection.send_error(
                    msg["id"],
                    specification.error_code,
                    str(err) or specification.error_message,
                )
                return
            connection.send_result(msg["id"], result)

        return handle

    for handler in (
        feature_handler(specification) for specification in lifecycle.websocket_routes
    ):
        register_command(handler)
