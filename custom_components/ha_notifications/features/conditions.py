"""Validate visual conditions and compile them for Home Assistant."""

from __future__ import annotations

import asyncio
import inspect
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.event import (
    TrackTemplate,
    TrackTemplateResult,
    async_track_template_result,
    async_track_time_interval,
)
from homeassistant.helpers.template import (
    Template,
    TemplateError,
    result_as_boolean,
)
from homeassistant.util import dt as dt_util
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..const import ConditionType, TransitionKind
from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from ..domain.durations import duration_seconds, parse_duration
from ..support.templates import render_template
from .confirmation import clear_pending_actions, pending_action_ids


class MonitorConfig(BaseModel):
    """Validated watcher settings for one alert."""

    model_config = ConfigDict(extra="allow")

    on_change: bool | None = None
    startup: bool | None = None
    interval: int | float | None = None

    @field_validator("interval", mode="before")
    @classmethod
    def _normalize_interval(cls, value: Any) -> Any:
        return duration_seconds(value)


@dataclass(frozen=True)
class ConditionTransition:
    """Fact produced when an alert condition changes or needs attention."""

    kind: TransitionKind
    error: str | None = None
    source: str = ""
    had_pending_confirmation: bool = False
    facts: dict[str, bool] | None = None


class ConditionWatchers:
    """Own Home Assistant listeners for configured alert conditions."""

    def __init__(
        self,
        hass: HomeAssistant,
        on_condition_result: Callable[
            [str, bool | None, str | None, str], None
        ],
        on_check: Callable[[str, str], None],
        confirmation_interval: Callable[
            [dict[str, Any]], timedelta | None
        ] = lambda _alert: None,
    ) -> None:
        self._hass = hass
        self._on_condition_result = on_condition_result
        self._on_check = on_check
        self._confirmation_interval = confirmation_interval
        self._unsubscribers: dict[str, list[Callable[[], None]]] = {}

    def _track_template(
        self,
        source: str,
        on_result: Callable[[bool | None, str | None, Event | None], None],
    ) -> Callable[[], None]:
        template = Template(source, self._hass)

        @callback
        def template_callback(
            event: Event | None,
            updates: list[TrackTemplateResult],
        ) -> None:
            for update in updates:
                if update.template is not template:
                    continue
                if isinstance(update.result, TemplateError):
                    on_result(None, str(update.result), event)
                else:
                    on_result(result_as_boolean(update.result), None, event)

        return async_track_template_result(
            self._hass,
            [TrackTemplate(template, None)],
            template_callback,
        ).async_remove

    def _track_interval(
        self, interval: timedelta, on_interval: Callable[[datetime], None]
    ) -> Callable[[], None]:
        @callback
        def interval_callback(now: datetime) -> None:
            on_interval(now)

        return async_track_time_interval(self._hass, interval_callback, interval)

    def configure(self, alert: dict[str, Any]) -> None:
        alert_id = alert["id"]
        self.unconfigure(alert_id)
        if not alert.get("enabled", True) or not alert.get("notification"):
            return

        monitor = MonitorConfig.model_validate(alert.get("monitor") or {})
        unsubscribers: list[Callable[[], None]] = []
        if monitor.on_change:
            unsubscribers.append(
                self._track_template(
                    compile_condition(alert),
                    lambda active, error, _event: self._on_condition_result(
                        alert_id, active, error, "change"
                    ),
                )
            )

        interval = parse_duration(monitor.interval)
        if interval is not None:
            unsubscribers.append(
                self._track_interval(
                    interval, lambda _now: self._on_check(alert_id, "interval")
                )
            )
        confirmation_interval = self._confirmation_interval(alert)
        if confirmation_interval is not None:
            unsubscribers.append(
                self._track_interval(
                    confirmation_interval,
                    lambda _now: self._on_check(alert_id, "confirmation"),
                )
            )
        self._unsubscribers[alert_id] = unsubscribers

    def unconfigure(self, alert_id: str) -> None:
        for unsubscribe in self._unsubscribers.pop(alert_id, []):
            unsubscribe()


class ConditionFeature(FeatureBase):
    """Own condition compilation, evaluation, and condition watchers."""

    name = "conditions"
    dependencies = ("alerts", "alert_flow", "confirmation")

    def __init__(
        self,
        hass: Any,
        _state: Any,
        _config_storage: Any,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._alerts: dict[str, dict[str, Any]] = {}
        self._watchers: ConditionWatchers | None = None
        self._locks: dict[str, asyncio.Lock] = {}
        self._tasks: dict[str, set[asyncio.Task[Any]]] = {}
        self._runtime_for: Callable[[str], dict[str, Any]] | None = None
        self._on_transition: Callable[
            [dict[str, Any], ConditionTransition, datetime], Awaitable[None]
        ] | None = None

    def set_alerts(self, alerts: dict[str, Any]) -> None:
        mapped_alerts = {
            alert.id: alert.model_dump(exclude_none=True)
            for alert in alerts.values()
        }
        self._alerts = mapped_alerts

    async def on_setup(self) -> None:
        alert_feature = self.feature("alerts")
        self._runtime_for = alert_feature.runtime
        self._on_transition = self.feature("alert_flow").handle_condition
        confirmation_feature = self.feature("confirmation")
        self._watchers = ConditionWatchers(
            self._hass,
            self._schedule_condition_result,
            self._schedule_check,
            confirmation_feature.reminder_interval,
        )
        self.set_alerts(alert_feature.alerts)
        for alert in self._alerts.values():
            await self._configure(alert)

    async def on_unload(self) -> None:
        for alert_id in tuple(self._alerts):
            await self._unconfigure(alert_id)
        self._watchers = None
        self._locks.clear()
        self._tasks.clear()
        self._on_transition = None

    async def check_alert(
        self, alert_id: str, *, source: str, now: datetime
    ) -> None:
        lock = self._locks.setdefault(alert_id, asyncio.Lock())
        async with lock:
            await self._check(alert_id, source=source, now=now)

    async def evaluate_all(self, *, source: str, now: datetime) -> None:
        if self._watchers is None:
            return
        for alert in self._alerts.values():
            if not alert.get("enabled", True):
                continue
            monitor = alert.get("monitor") or {}
            if source == "startup" and not monitor.get("startup", True):
                continue
            await self.check_alert(alert["id"], source=source, now=now)

    async def _configure(self, alert: dict[str, Any]) -> None:
        await self._unconfigure(alert["id"])
        self._runtime_for(alert["id"])
        if self._watchers is not None:
            self._watchers.configure(alert)

    async def _unconfigure(self, alert_id: str) -> None:
        if self._watchers is not None:
            self._watchers.unconfigure(alert_id)
        tasks = self._tasks.pop(alert_id, set())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._locks.pop(alert_id, None)

    async def _check(self, alert_id: str, *, source: str, now: datetime) -> None:
        alert = self._alerts.get(alert_id)
        if alert is None or not alert.get("notification"):
            return
        template = Template(compile_condition(alert), self._hass)
        try:
            result = template.async_render(parse_result=True, strict=False)
            if inspect.isawaitable(result):
                result = await result
        except TemplateError as err:
            active, error = None, str(err)
        else:
            active, error = result_as_boolean(result), None
        await self._condition_result(
            alert_id, active, error, source=source, now=now
        )

    async def _condition_result(
        self,
        alert_id: str,
        active: bool | None,
        error: str | None,
        *,
        source: str,
        now: datetime,
    ) -> None:
        alert = self._alerts.get(alert_id)
        if alert is None:
            return
        if self._runtime_for is None:
            raise RuntimeError("Condition feature has not been set up")
        runtime = self._runtime_for(alert_id)
        facts = await self._condition_facts(alert)
        transition = self._transition_for(
            runtime,
            alert,
            active,
            error,
            now,
            source,
            facts,
            self.feature("confirmation").reminder_due(alert, runtime, now),
        )
        if transition.kind == TransitionKind.NO_CHANGE:
            return
        if self._on_transition is None:
            raise RuntimeError("Condition feature has not been set up")
        await self._on_transition(alert, transition, now)

    async def condition_result(
        self,
        alert_id: str,
        active: bool | None,
        error: str | None,
        *,
        source: str,
        now: datetime,
    ) -> None:
        lock = self._locks.setdefault(alert_id, asyncio.Lock())
        async with lock:
            await self._condition_result(
                alert_id, active, error, source=source, now=now
            )

    async def _condition_facts(
        self, alert: dict[str, Any]
    ) -> dict[str, bool]:
        """Evaluate named conditions for notification template branches."""

        facts: dict[str, bool] = {}
        for condition in alert.get("conditions", []):
            condition_id = condition.get("id") if isinstance(condition, dict) else None
            if not condition_id:
                continue
            try:
                result = await render_template(
                    self._hass, compile_condition({"conditions": [condition]})
                )
            except TemplateError:
                result = False
            facts[str(condition_id)] = result_as_boolean(result)
        return facts

    @staticmethod
    def _transition_for(
        state: dict[str, Any],
        alert: dict[str, Any],
        active: bool | None,
        error: str | None,
        now: datetime,
        source: str,
        facts: dict[str, bool] | None = None,
        confirmation_due: bool = False,
    ) -> ConditionTransition:
        if error is not None:
            return ConditionTransition(
                TransitionKind.CONDITION_ERROR, error, source, facts=facts
            )
        state["last_evaluated"] = now.isoformat()
        if not active:
            if not state.get("active", False):
                return ConditionTransition(TransitionKind.NO_CHANGE, source=source)
            pending = bool(pending_action_ids(state))
            state.update(
                active=False,
                acknowledged=False,
                attempts=0,
                notification_id=None,
                flow_id=None,
            )
            clear_pending_actions(state)
            return ConditionTransition(
                TransitionKind.BECAME_INACTIVE,
                source=source,
                had_pending_confirmation=pending,
                facts=facts,
            )
        if not state.get("active", False):
            state.update(
                active=True, acknowledged=False, attempts=0,
                started_at=now.isoformat(),
                notification_id=f"ha_notifications_{alert['id']}_{uuid.uuid4().hex[:10]}",
            )
            ConditionFeature._ensure_flow_id(state, alert)
            return ConditionTransition(
                TransitionKind.BECAME_ACTIVE, source=source, facts=facts
            )
        if state.get("acknowledged", False):
            return ConditionTransition(TransitionKind.NO_CHANGE, source=source)
        has_sent = bool(state.get("last_notified") or state.get("attempts", 0))
        monitor = MonitorConfig.model_validate(alert.get("monitor", {}))
        if (source == "startup" and monitor.startup and not has_sent) or (
            source == "enabled" and not has_sent
        ) or (
            source in ("reload", "startup", "interval", "confirmation")
            and confirmation_due
        ):
            ConditionFeature._ensure_flow_id(state, alert)
            return ConditionTransition(
                TransitionKind.SHOULD_SEND, source=source, facts=facts
            )
        return ConditionTransition(TransitionKind.NO_CHANGE, source=source)

    @staticmethod
    def _ensure_flow_id(state: dict[str, Any], alert: dict[str, Any]) -> None:
        if not state.get("flow_id"):
            state["flow_id"] = f"flow_{alert['id']}_{uuid.uuid4().hex[:8]}"

    def _schedule_condition_result(
        self, alert_id: str, active: bool | None, error: str | None, source: str
    ) -> None:
        self._schedule_task(
            alert_id,
            self.condition_result(
                alert_id, active, error, source=source, now=dt_util.utcnow()
            ),
        )

    def _schedule_check(self, alert_id: str, source: str) -> None:
        self._schedule_task(
            alert_id,
            self.check_alert(alert_id, source=source, now=dt_util.utcnow()),
        )

    def _schedule_task(self, alert_id: str, coroutine: Awaitable[Any]) -> None:
        task = self._hass.async_create_task(coroutine)
        self._tasks.setdefault(alert_id, set()).add(task)

        def remove_task(done_task: asyncio.Task[Any]) -> None:
            tasks = self._tasks.get(alert_id)
            if tasks is None:
                return
            tasks.discard(done_task)
            if not tasks:
                self._tasks.pop(alert_id, None)

        task.add_done_callback(remove_task)

    @websocket_route(
        "conditions.validate",
        command="validate_conditions",
        arguments=(WebsocketArgument("alert", dict),),
        error_code="condition_invalid",
        error_message="Condition is invalid.",
    )
    async def validate(self, alert: dict[str, Any]) -> bool:
        """Compile and evaluate a condition without persisting an alert."""

        try:
            result = await render_template(
                self._hass, compile_condition(alert)
            )
        except TemplateError as err:
            error = str(err)
        else:
            result_as_boolean(result)
            error = None
        if error is not None:
            raise ValueError(f"Condition template failed: {error}")
        return True

class ConditionConfig(BaseModel):
    """Validated visual condition used by the editor and trigger workflow."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str | None = None
    type: str = ConditionType.TEMPLATE.value
    template: str | None = None
    model_for: Any = Field(default=None, alias="for")

    @field_validator("model_for", mode="before")
    @classmethod
    def normalize_duration(cls, value: Any) -> Any:
        if value is None or value == "[object Object]":
            return None
        try:
            parse_duration(value)
        except ValueError:
            return None
        return value

    @model_validator(mode="before")
    @classmethod
    def normalize_input(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return {"template": str(value or "")}
        values = dict(value)
        if "for" in values:
            values["model_for"] = values.pop("for")
        return values


def _seconds(value: Any) -> int:
    """Get whole seconds."""

    duration = parse_duration(value, timedelta())

    return max(0, int(duration.total_seconds()))


def _list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _combine(expressions: list[str], operator: str) -> str:
    if not expressions:
        return ""
    if len(expressions) == 1:
        return expressions[0]
    return "(" + operator.join(expressions) + ")"


def _template_result_name(index: int) -> str:
    return f"nc_condition_{index}"


def _template_condition_block(template: str, result_name: str) -> str | None:
    stripped = template.strip()
    if stripped.startswith("{{") and stripped.endswith("}}"):
        stripped = stripped[2:-2].strip()
        if not stripped:
            return None
        return f"{{% set {result_name} = ({stripped}) %}}"

    if not stripped:
        return None

    if "{%" in stripped:
        return f"{{% set {result_name} %}}{stripped}{{% endset %}}"

    return f"{{% set {result_name} = ({stripped}) %}}"


def compile_condition(alert: Any) -> str:
    """Compile visual conditions into one Jinja condition."""

    expressions: list[str] = []
    template_blocks: list[str] = []

    for condition in alert.get("conditions", []):
        condition = ConditionConfig.model_validate(condition).model_dump(
            exclude_none=True, by_alias=True
        )
        if condition.get("enabled") is False:
            continue

        condition_type = condition.get("type")

        if condition_type == ConditionType.STATE:
            entity_ids = [
                str(item) for item in _list(condition.get("entity_id")) if item
            ]
            states = [str(item) for item in _list(condition.get("state")) if item]

            if not entity_ids or not states:
                continue

            duration = _seconds(condition.get("for"))
            entity_expressions = []

            for entity_id in entity_ids:
                state_expressions = [
                    f"is_state({json.dumps(entity_id)}, {json.dumps(state)})"
                    for state in states
                ]
                expression = _combine(state_expressions, " or ")

                if duration:
                    expression = (
                        "("
                        f"{expression}"
                        " and "
                        f"(now() - states["
                        f"{json.dumps(entity_id)}"
                        "].last_changed)"
                        ".total_seconds() >= "
                        f"{duration}"
                        ")"
                    )

                entity_expressions.append(expression)

            expressions.append(_combine(entity_expressions, " or "))

        elif condition_type == ConditionType.NUMERIC:
            entity_ids = [
                str(item) for item in _list(condition.get("entity_id")) if item
            ]

            if not entity_ids:
                continue

            entity_expressions = []
            duration = _seconds(condition.get("for"))

            for entity_id in entity_ids:
                value = f"states({json.dumps(entity_id)}) | float(0)"
                parts: list[str] = []

                if condition.get("above") is not None:
                    parts.append(f"{value} > {float(condition['above'])}")

                if condition.get("below") is not None:
                    parts.append(f"{value} < {float(condition['below'])}")

                if duration:
                    parts.append(
                        f"(now() - states[{json.dumps(entity_id)}].last_changed)"
                        f".total_seconds() >= {duration}"
                    )

                if parts:
                    entity_expressions.append(_combine(parts, " and "))

            if entity_expressions:
                expressions.append(_combine(entity_expressions, " or "))

        elif condition_type == ConditionType.ATTRIBUTE:
            entity_id = str(condition.get("entity_id", ""))
            attribute = str(condition.get("attribute", ""))
            expected = condition.get("value")

            if entity_id and attribute:
                expressions.append(
                    f"state_attr("
                    f"{json.dumps(entity_id)}, "
                    f"{json.dumps(attribute)}"
                    f") == "
                    f"{json.dumps(expected)}"
                )

        elif condition_type == ConditionType.TEMPLATE:
            template = str(condition.get("template", "")).strip()

            if template:
                result_name = _template_result_name(len(template_blocks))
                block = _template_condition_block(template, result_name)
                if block:
                    template_blocks.append(block)
                    expressions.append(f"({result_name} | bool)")

    if not expressions:
        return "{{ true }}"

    operator = " and "
    if alert.get("logic") in ("any", "or"):
        operator = " or "

    expression = "{{ " + operator.join(expressions) + " }}"
    if template_blocks:
        return "\n".join(template_blocks + [expression])

    return expression
