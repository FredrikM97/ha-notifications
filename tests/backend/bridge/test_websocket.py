"""Tests for the Home Assistant websocket transport adapter."""

from __future__ import annotations

import importlib
from types import MappingProxyType
from unittest.mock import patch

import voluptuous as vol
from homeassistant.components import websocket_api

from custom_components.ha_notifications.bridge import websocket
from custom_components.ha_notifications.controller.lifecycle import (
    WebsocketArgument,
    WebsocketRoute,
)


def _passthrough_decorator(_schema):
    return lambda function: function


class Connection:
    def __init__(self) -> None:
        self.errors: list[tuple[object, str, str]] = []
        self.results: list[tuple[object, object]] = []

    def send_error(self, message_id: object, code: str, message: str) -> None:
        self.errors.append((message_id, code, message))

    def send_result(self, message_id: object, result: object) -> None:
        self.results.append((message_id, result))


class Lifecycle:
    def __init__(self, routes: tuple[WebsocketRoute, ...]) -> None:
        self.websocket_routes = routes

    async def dispatch(self, name: str, **kwargs: object) -> object:
        return {"route": name, **kwargs}


def test_optional_none_argument_is_validated_as_optional() -> None:
    handlers = []
    schemas = []

    def capture_decorator(schema):
        schemas.append(schema)
        return lambda function: function

    with (
        patch.object(websocket_api, "websocket_command", capture_decorator),
        patch.object(websocket_api, "async_response", lambda fn: fn),
    ):
        module = importlib.reload(websocket)
        module.register(
            Lifecycle(
                (
                    WebsocketRoute(
                        "history.list",
                        "history",
                        (WebsocketArgument("alert_id", str, False, None),),
                    ),
                )
            ),
            handlers.append,
        )

    validated = vol.Schema(schemas[0])({"type": "ha_notifications/history"})
    assert validated["alert_id"] is None

def test_registers_all_public_commands() -> None:
    handlers = []

    with (
        patch.object(websocket_api, "websocket_command", _passthrough_decorator),
        patch.object(websocket_api, "async_response", lambda fn: fn),
    ):
        module = importlib.reload(websocket)
        module.register(
            Lifecycle(
                tuple(
                    WebsocketRoute(f"route.{index}", f"command_{index}")
                    for index in range(12)
                )
            ),
            handlers.append,
        )

    assert len(handlers) == 12
    assert all(handler.__name__ == "handle" for handler in handlers)

async def test_results_convert_mappingproxy_values_for_json() -> None:
    handlers = []

    class ConfigLifecycle(Lifecycle):
        async def dispatch(self, name: str, **kwargs: object) -> object:
            return MappingProxyType(
                {
                    "alerts": MappingProxyType(
                        {"confirmation": MappingProxyType({"enabled": True})}
                    )
                }
            )

    with (
        patch.object(websocket_api, "websocket_command", _passthrough_decorator),
        patch.object(websocket_api, "async_response", lambda fn: fn),
    ):
        module = importlib.reload(websocket)
        module.register(
            ConfigLifecycle(
                (WebsocketRoute("configuration.get", "get_config"),)
            ),
            handlers.append,
        )

    connection = Connection()
    await handlers[0](None, connection, {"id": 4})

    assert connection.results == [
        (4, {"alerts": {"confirmation": {"enabled": True}}}),
    ]