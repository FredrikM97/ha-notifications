"""Pure follow-up action execution: render an alert's configured actions.

Replaces `runtime/actions.py`. Holds no state and makes no decisions about
*when* to run - `controller/core.py` decides that and calls
`build_service_calls` afterwards, then executes the returned commands.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .commands import CallService, Command
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
