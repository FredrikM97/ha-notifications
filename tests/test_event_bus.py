"""Unit tests for controller/bus.py - the generic publish/ask event bus.

No Home Assistant fakes needed: `EventBus` has zero `homeassistant`
imports and only knows how to route events/queries to registered
handlers/responders.
"""

from __future__ import annotations

import importlib
import unittest

from test_support import PACKAGE_NAME, ensure_package

ensure_package()
bus_module = importlib.import_module(f"{PACKAGE_NAME}.controller.bus")
events_module = importlib.import_module(f"{PACKAGE_NAME}.controller.events")
commands_module = importlib.import_module(f"{PACKAGE_NAME}.controller.commands")

Event = events_module.Event
Emit = commands_module.Emit
RunBatch = commands_module.RunBatch


class _FailingCommand:
    """A command the fake `execute()` always raises on - simulates a real
    gateway call (e.g. `CallService`) failing."""


def _make_bus():
    executed: list = []

    async def execute_leaf(command):
        executed.append(command)
        if isinstance(command, _FailingCommand):
            raise ValueError("boom")

    bus = bus_module.EventBus()
    bus.listen(_FailingCommand, execute_leaf)
    return bus, executed


class PublishTests(unittest.IsolatedAsyncioTestCase):
    async def test_publish_calls_all_subscribed_handlers(self):
        bus, _executed = _make_bus()
        seen = []

        async def handler_one(event, _bus):
            seen.append(("one", event.payload["value"]))
            return []

        async def handler_two(event, _bus):
            seen.append(("two", event.payload["value"]))
            return []

        bus.subscribe("thing.happened", handler_one)
        bus.subscribe("thing.happened", handler_two)

        await bus.publish(Event("thing.happened", {"value": 42}))

        self.assertEqual(seen, [("one", 42), ("two", 42)])

    async def test_publish_ignores_unrelated_event_types(self):
        bus, _executed = _make_bus()
        calls = []

        async def handler(_event, _bus):
            calls.append(1)
            return []

        bus.subscribe("thing.happened", handler)
        await bus.publish(Event("other.thing", {}))

        self.assertEqual(calls, [])

    async def test_emit_cascades_into_another_publish(self):
        bus, executed = _make_bus()
        seen = []

        async def on_first(_event, _bus):
            return [Emit(Event("second", {}))]

        async def on_second(_event, _bus):
            seen.append("second")
            return []

        bus.subscribe("first", on_first)
        bus.subscribe("second", on_second)

        await bus.publish(Event("first", {}))

        self.assertEqual(seen, ["second"])

    async def test_run_batch_publishes_on_success(self):
        bus, executed = _make_bus()
        seen = []

        async def on_done(_event, _bus):
            seen.append("done")
            return []

        bus.subscribe("done", on_done)

        async def handler(_event, _bus):
            return [RunBatch([], on_success=Event("done", {}))]

        bus.subscribe("go", handler)
        await bus.publish(Event("go", {}))

        self.assertEqual(seen, ["done"])

    async def test_run_batch_publishes_on_error_with_error_message(self):
        bus, _executed = _make_bus()
        seen = []

        async def on_failed(event, _bus):
            seen.append(event.payload["error"])
            return []

        bus.subscribe("failed", on_failed)

        async def handler(_event, _bus):
            return [RunBatch([_FailingCommand()], on_error=Event("failed", {"context": "x"}))]

        bus.subscribe("go", handler)
        await bus.publish(Event("go", {}))

        self.assertEqual(seen, ["boom"])

    async def test_run_batch_swallows_error_when_no_on_error(self):
        bus, _executed = _make_bus()

        async def handler(_event, _bus):
            return [RunBatch([_FailingCommand()])]

        bus.subscribe("go", handler)
        # Should not raise even without an on_error handler - RunBatch's
        # contract is "never leak an inner command's exception".
        try:
            await bus.publish(Event("go", {}))
        except Exception as err:  # pragma: no cover - failure path
            self.fail(f"RunBatch leaked an exception: {err}")


class AskRespondTests(unittest.IsolatedAsyncioTestCase):
    async def test_ask_calls_the_registered_responder(self):
        bus, _executed = _make_bus()

        async def responder(payload):
            return {"echo": payload["value"]}

        bus.respond("echo", responder)
        result = await bus.ask("echo", {"value": 7})

        self.assertEqual(result, {"echo": 7})

    async def test_ask_defaults_to_empty_payload(self):
        bus, _executed = _make_bus()

        async def responder(payload):
            return payload

        bus.respond("noop", responder)
        result = await bus.ask("noop")

        self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()
