"""Tests for the Home Assistant websocket transport adapter."""

from __future__ import annotations

import importlib
import unittest
from unittest.mock import patch

import voluptuous as vol
from homeassistant.components import websocket_api

from custom_components.notification_center.bridge import websocket
from custom_components.notification_center.controller.lifecycle import (
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
        if name == "testing.discard":
            raise RuntimeError("discard failed")
        return {"route": name, **kwargs}


class WebsocketTests(unittest.IsolatedAsyncioTestCase):
    def test_optional_none_argument_is_validated_as_optional(self) -> None:
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

        validated = vol.Schema(schemas[0])({"type": "notification_center/history"})
        self.assertIsNone(validated["alert_id"])

    def test_registers_all_public_commands(self) -> None:
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

        self.assertEqual(len(handlers), 12)
        self.assertTrue(all(handler.__name__ == "handle" for handler in handlers))

    async def test_discard_errors_use_transport_error_contract(self) -> None:
        handlers = []

        with (
            patch.object(websocket_api, "websocket_command", _passthrough_decorator),
            patch.object(websocket_api, "async_response", lambda fn: fn),
        ):
            module = importlib.reload(websocket)
            module.register(
                Lifecycle(
                    (
                        WebsocketRoute(
                            "testing.discard",
                            "discard_test_payload",
                            (WebsocketArgument("session_id", str),),
                            "discard_failed",
                            "Unable to discard test payload.",
                        ),
                    )
                ),
                handlers.append,
            )

        connection = Connection()
        await handlers[0](None, connection, {"id": 3, "session_id": "session"})

        self.assertEqual(connection.errors, [(3, "discard_failed", "discard failed")])
        self.assertEqual(connection.results, [])
if __name__ == "__main__":
    unittest.main()