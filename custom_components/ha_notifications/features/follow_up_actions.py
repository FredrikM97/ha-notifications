"""Render configured follow-up actions into service-call commands."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ..const import (
    EVENT_RUNTIME_PERSIST_REQUESTED,
    STATE_RUNTIME,
    HistoryEventType,
    StateRoot,
)
from ..controller.lifecycle import FeatureBase
from ..domain.service_calls import ServiceCall
from ..domain.template_values import remove_nulls, render_template_values
from ..support.templates import render_template
from . import history
from .feature_config import AlertFeatureConfig


class FollowUpActionConfig(BaseModel):
    """One permissive action payload retained for template rendering."""

    model_config = ConfigDict(extra="allow")

    action: Any = None
    target: Any = Field(default_factory=dict)
    data: Any = Field(default_factory=dict)


class PostSendActionsConfig(AlertFeatureConfig):
    """Validated actions executed after a notification is sent."""

    model_config = ConfigDict(extra="allow")

    enabled: bool | None = None
    actions: list[dict[str, Any]] | None = None


@dataclass(frozen=True)
class ActionResult:
    """One configured action's render outcome, preserving its original index."""

    index: int
    command: ServiceCall | None
    error: str | None


@dataclass(frozen=True)
class ActionContext:
    """Typed template inputs for one follow-up action execution."""

    alert_id: str
    alert_name: str
    attempt: int
    test: bool
    now: Any
    confirmation_action_id: str | None
    confirmed_by: str | None = None

class FollowUpActionsFeature(FeatureBase):
    """Own follow-up action rendering, execution, and outcome recording."""

    name = "follow_up_actions"

    def __init__(self, hass: Any, state: StateRoot, *_args: Any) -> None:
        super().__init__(hass, state, *_args)
        self._hass = hass
        self._state = state

    async def run(
        self,
        alert: dict[str, Any],
        attempt: int,
        now: Any,
        test: bool,
        record_history: bool,
        actions: list[dict[str, Any]] | None = None,
        confirmed_by: str | None = None,
    ) -> None:
        """Render, execute, and record post-send or confirmation actions."""

        post_send = PostSendActionsConfig.model_validate(
            alert.get("post_send_actions") or {}
        )
        action_list = actions if actions is not None else (post_send.actions or [])
        if not action_list or (actions is None and not post_send.enabled):
            return
        context = ActionContext(
            alert["id"],
            alert["name"],
            attempt,
            test,
            now,
                self._state[STATE_RUNTIME].get(alert["id"], {}).get(
                "confirmation_action_id"
            ),
            confirmed_by,
        )
        results = await self._render_actions(
            action_list,
            context,
        )
        for result in results:
            event_type = HistoryEventType.NOTIFICATION_ACTION
            message = "Action executed."
            details = {"index": result.index}
            if result.command is None:
                event_type = HistoryEventType.NOTIFICATION_ACTION_FAILED
                message = "Action failed."
                details["error"] = result.error
            else:
                try:
                    await self._hass.services.async_call(
                        result.command.domain,
                        result.command.service,
                        service_data=result.command.data,
                        target=result.command.target,
                        blocking=True,
                    )
                    details["action"] = (
                        f"{result.command.domain}.{result.command.service}"
                    )
                except Exception as err:
                    event_type = HistoryEventType.NOTIFICATION_ACTION_FAILED
                    message = "Action failed."
                    details["error"] = str(err)
            if record_history and history.record_event(
                self._state,
                self._state[STATE_RUNTIME].get(alert["id"]),
                alert,
                event_type,
                message,
                details,
                now,
            ):
                self._hass.bus.async_fire(EVENT_RUNTIME_PERSIST_REQUESTED)

    async def _render_actions(
        self, actions: list[dict[str, Any]], context: ActionContext
    ) -> list[ActionResult]:
        """Render each configured action independently."""

        variables = {
            "alert_id": context.alert_id,
            "alert_name": context.alert_name,
            "alert_active": True,
            "attempt": context.attempt,
            "test": context.test,
            "now": context.now,
            "notification_id": f"ha_notifications_{context.alert_id}",
            "confirmation_action_id": context.confirmation_action_id,
            "confirmed_by": context.confirmed_by,
        }
        results: list[ActionResult] = []
        for index, action in enumerate(actions, start=1):
            try:
                command = await self._render_action(
                    FollowUpActionConfig.model_validate(action), variables
                )
                results.append(ActionResult(index, command, None))
            except Exception as err:  # noqa: BLE001
                results.append(ActionResult(index, None, str(err)))
        return results

    async def _render_action(
        self, action: FollowUpActionConfig, variables: dict[str, Any]
    ) -> ServiceCall:
        async def render(source: str, values: dict[str, Any]) -> Any:
            return await render_template(self._hass, source, values)

        service = str(
            await render_template_values(
                action.action,
                variables,
                render,
            )
            or ""
        )
        if not service or "." not in service:
            raise ValueError("Invalid service action.")
        target = await render_template_values(action.target, variables, render)
        data = remove_nulls(
            await render_template_values(action.data, variables, render)
        )
        domain, service_name = service.split(".", 1)
        return ServiceCall(
            domain=domain,
            service=service_name,
            data=data if isinstance(data, dict) else {},
            target=target if target else None,
        )
