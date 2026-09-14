"""Render configured follow-up actions into service-call commands."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..controller.commands import CallService, Command, Emit, RunBatch
from ..controller import events as ev
from ..controller.events import Event
from ..const import HistoryEventType
from .rendering import Render, remove_none, render_value


@dataclass(frozen=True)
class ActionResult:
    """One configured action's render outcome, preserving its original index."""

    index: int
    command: Command | None
    error: str | None


async def build_service_calls(
    actions: list[dict[str, Any]],
    variables: dict[str, Any],
    render: Render,
) -> list[ActionResult]:
    """Render a configured list of follow-up actions into service calls.

    Each action is rendered independently: one invalid/failing action does
    not stop the others from rendering, matching the original per-action
    try/except behaviour. The caller (`core.py`) inspects `.error` on each
    result to decide what to log.
    """

    results: list[ActionResult] = []

    for index, action in enumerate(actions, start=1):
        try:
            results.append(
                ActionResult(index, await _render_one(action, variables, render), None)
            )
        except Exception as err:  # noqa: BLE001 - surfaced as a plain result, not raised
            results.append(ActionResult(index, None, str(err)))

    return results


async def _render_one(
    action: dict[str, Any],
    variables: dict[str, Any],
    render: Render,
) -> Command:
    service = str(await render_value(render, action.get("action"), variables) or "")
    if not service or "." not in service:
        raise ValueError("Invalid service action.")

    target = await render_value(render, action.get("target", {}), variables)
    data = remove_none(await render_value(render, action.get("data", {}), variables))

    service_data = data if isinstance(data, dict) else {}
    service_target = target if target else None

    domain, service_name = service.split(".", 1)
    return CallService(domain, service_name, service_data, service_target)


# ----------------------------------------------------------------------
# Event-bus adapter - the only impure part of this module
# ----------------------------------------------------------------------


def register(bus: Any) -> None:
    """Subscribe this module's reactions to the events it owns."""

    bus.subscribe(ev.NOTIFICATION_SENT, handle_notification_sent)
    bus.subscribe(ev.ACTIONS_RUN_REQUESTED, handle_actions_run_requested)


async def handle_notification_sent(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    alert = payload["alert"]
    if not alert["notification"].get("actions_enabled", False):
        return []

    variables = {
        "alert_id": alert["id"],
        "alert_name": alert["name"],
        "alert_active": True,
        "attempt": payload["attempt"],
        "test": payload.get("test", False),
        "now": payload["now"],
        "notification_id": f"notification_center_{alert['id']}",
        "confirmation_action_id": payload.get("confirmation_action_id"),
    }
    return await _run_actions(
        bus,
        alert,
        alert["notification"].get("actions", []),
        variables,
        HistoryEventType.NOTIFICATION_ACTION,
        HistoryEventType.NOTIFICATION_ACTION_FAILED,
        record_history=payload.get("record_history", True),
    )


async def handle_actions_run_requested(event: Event, bus: Any) -> list[Command]:
    payload = event.payload
    return await _run_actions(
        bus,
        payload["alert"],
        payload["actions"],
        payload["variables"],
        HistoryEventType.CONFIRMATION_ACTION,
        HistoryEventType.CONFIRMATION_ACTION_FAILED,
        record_history=payload.get("record_history", True),
    )


async def _run_actions(
    bus: Any,
    alert: dict[str, Any],
    action_list: list[dict[str, Any]],
    variables: dict[str, Any],
    success_type: HistoryEventType,
    failure_type: HistoryEventType,
    *,
    record_history: bool,
) -> list[Command]:
    render = await bus.ask(ev.RENDER_TEMPLATE)
    results = await build_service_calls(action_list, variables, render)
    now = variables.get("now")

    commands: list[Command] = []
    for result in results:
        if result.command is None:
            commands.append(
                Emit(
                    Event(
                        ev.ACTION_FAILED,
                        {
                            "alert": alert,
                            "index": result.index,
                            "error": result.error,
                            "event_type": failure_type,
                            "record_history": record_history,
                            "now": now,
                        },
                    )
                )
            )
            continue

        commands.append(
            RunBatch(
                [result.command],
                on_success=Event(
                    ev.ACTION_EXECUTED,
                    {
                        "alert": alert,
                        "index": result.index,
                        "action": f"{result.command.domain}.{result.command.service}",
                        "event_type": success_type,
                        "record_history": record_history,
                        "now": now,
                    },
                ),
                on_error=Event(
                    ev.ACTION_FAILED,
                    {
                        "alert": alert,
                        "index": result.index,
                        "event_type": failure_type,
                        "record_history": record_history,
                        "now": now,
                    },
                ),
            )
        )

    return commands
