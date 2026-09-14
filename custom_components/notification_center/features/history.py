"""Record alert history - a listener, not a kernel primitive.

Subscribes to the same fact events other features emit for their own
reasons and turns them into history entries via `support/history.py`'s
pure helpers, then persists via the existing generic `PersistSave`
command - no dedicated "record history" Command is needed.
"""

from __future__ import annotations

from typing import Any

from ..const import HistoryEventType
from ..controller.commands import Command, PersistSave
from ..controller import events as ev
from ..controller.events import Event
from ..support import history as history_module


def register(bus: Any) -> None:
    """Subscribe to every fact event worth recording to alert history."""

    bus.subscribe(ev.CONDITION_ERROR, _handle_condition_error)
    bus.subscribe(ev.CONDITION_ACTIVE, _handle_condition_active)
    bus.subscribe(ev.CONDITION_INACTIVE, _handle_condition_inactive)
    bus.subscribe(ev.NOTIFICATION_SENT, _handle_notification_sent)
    bus.subscribe(ev.NOTIFICATION_FAILED, _handle_notification_failed)
    bus.subscribe(ev.COMPLETION_SENT, _handle_completion_sent)
    bus.subscribe(ev.COMPLETION_FAILED, _handle_completion_failed)
    bus.subscribe(ev.CONFIRMED, _handle_confirmed)
    bus.subscribe(ev.ACTION_EXECUTED, _handle_action_executed)
    bus.subscribe(ev.ACTION_FAILED, _handle_action_failed)
    bus.subscribe(ev.NOTIFICATION_TEST_SENT, _handle_test_sent)


async def _handle_condition_error(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    return await _record(
        bus,
        payload["alert"],
        HistoryEventType.CONDITION_ERROR,
        "Template evaluation failed.",
        {"error": payload["error"], "source": payload["source"]},
        payload["now"],
    )


async def _handle_condition_active(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    return await _record(
        bus,
        payload["alert"],
        HistoryEventType.CONDITION_ACTIVE,
        "Condition became true.",
        {"source": payload["source"]},
        payload["now"],
    )


async def _handle_condition_inactive(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    return await _record(
        bus,
        payload["alert"],
        HistoryEventType.CONDITION_INACTIVE,
        "Condition became false.",
        {"source": payload["source"]},
        payload["now"],
    )


async def _handle_notification_sent(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    if not payload.get("record_history", True):
        return []
    return await _record(
        bus,
        payload["alert"],
        HistoryEventType.NOTIFICATION_SENT,
        "Notification sent.",
        {"attempt": payload["attempt"]},
        payload["now"],
    )


async def _handle_notification_failed(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    if not payload.get("record_history", True):
        return []
    return await _record(
        bus,
        payload["alert"],
        HistoryEventType.NOTIFICATION_FAILED,
        "Notification failed.",
        {"attempt": payload["attempt"], "error": payload.get("error")},
        payload["now"],
    )


async def _handle_completion_sent(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    return await _record(
        bus,
        payload["alert"],
        HistoryEventType.COMPLETION_SENT,
        "Completion notification sent.",
        {},
        payload["now"],
    )


async def _handle_completion_failed(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    return await _record(
        bus,
        payload["alert"],
        HistoryEventType.COMPLETION_FAILED,
        "Completion notification failed.",
        {"error": payload.get("error")},
        payload["now"],
    )


async def _handle_confirmed(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    return await _record(
        bus,
        payload["alert"],
        HistoryEventType.CONFIRMED,
        "Notification confirmed.",
        {"confirmed_by": payload["confirmed_by"]},
        payload["now"],
    )


async def _handle_action_executed(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    if not payload.get("record_history", True):
        return []
    return await _record(
        bus,
        payload["alert"],
        payload["event_type"],
        "Action executed.",
        {"index": payload["index"], "action": payload["action"]},
        payload.get("now"),
    )


async def _handle_action_failed(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    if not payload.get("record_history", True):
        return []
    return await _record(
        bus,
        payload["alert"],
        payload["event_type"],
        "Action failed.",
        {"index": payload["index"], "error": payload.get("error")},
        payload.get("now"),
    )


async def _handle_test_sent(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    return await _record(
        bus,
        payload["alert"],
        HistoryEventType.TEST,
        "Test notification sent.",
        {},
        payload["now"],
    )


async def _record(
    bus: Any,
    alert: dict[str, Any],
    event_type: HistoryEventType,
    message: str,
    details: dict[str, Any],
    now: Any,
) -> list[Command]:
    state_root = await bus.ask(ev.GET_STATE)
    runtime_state = await bus.ask(ev.GET_RUNTIME_STATE, {"alert_id": alert["id"]})
    if runtime_state is None:
        return []

    entry = history_module.format_entry(
        alert, event_type, message, details, now=now, flow_id=runtime_state.get("flow_id")
    )
    state_root["history"] = history_module.append_entry(state_root["history"], entry)
    runtime_state["last_event"] = entry

    return [PersistSave(key="runtime_state", data=state_root)]
