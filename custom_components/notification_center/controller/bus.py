"""Typed event routing and command dispatch for the integration.

No Home Assistant import, no business logic: `EventBus` only knows how to
route a published `Event`, dispatch handlers' `Command` results, and answer
named queries. Events are never commands: cascading publication is represented
explicitly by the `Emit` command.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from .commands import Command, Emit, RunBatch
from .events import Event

Handler = Callable[[Event, "EventBus"], Awaitable[list[Command]]]
Responder = Callable[[dict[str, Any]], Awaitable[Any]]
CommandListener = Callable[[Any], Awaitable[None]]


class EventBus:
    """Publish facts, execute typed commands, and answer reads."""

    def __init__(self) -> None:
        self._handlers: dict[str, list[Handler]] = {}
        self._responders: dict[str, Responder] = {}
        self._command_listeners: dict[type[Any], CommandListener] = {}

    def subscribe(self, event_type: str, handler: Handler) -> None:
        """Register a feature module's reaction to one fact event type."""

        self._handlers.setdefault(event_type, []).append(handler)

    def respond(self, query_name: str, responder: Responder) -> None:
        """Register the (single) responder for one named read query."""

        self._responders[query_name] = responder

    def listen(self, command_type: type[Any], listener: CommandListener) -> None:
        """Register the listener that executes one leaf command type."""

        self._command_listeners[command_type] = listener

    async def publish(self, event: Event) -> None:
        """Call every handler subscribed to `event.type`, executing what they return.

        Handlers may return `Emit`/`RunBatch` commands, which recurse back
        into `publish`/`execute` - this is what makes effects cascade.
        """

        for handler in list(self._handlers.get(event.type, ())):
            commands = await handler(event, self)
            for command in commands:
                await self.execute(command)

    async def execute(self, command: Command) -> None:
        """Execute bus orchestration or dispatch a leaf command to its listener."""

        if isinstance(command, Emit):
            await self.publish(command.event)
            return

        if isinstance(command, RunBatch):
            await self._run_batch(command)
            return

        listener = self._command_listeners[type(command)]
        await listener(command)

    async def _run_batch(self, command: RunBatch) -> None:
        try:
            for inner in command.commands:
                await self.execute(inner)
        except Exception as err:  # noqa: BLE001 - reported as an event
            if command.on_error is not None:
                payload = dict(command.on_error.payload)
                payload["error"] = str(err)
                await self.publish(Event(command.on_error.type, payload))
            return

        if command.on_success is not None:
            await self.publish(command.on_success)

    async def ask(self, query_name: str, payload: dict[str, Any] | None = None) -> Any:
        """Request data from the query's one registered responder."""

        responder = self._responders[query_name]
        return await responder(payload or {})
