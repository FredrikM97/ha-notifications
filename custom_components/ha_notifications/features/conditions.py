"""Validate visual conditions and compile them for Home Assistant."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import Event, HomeAssistant, State, callback
from homeassistant.helpers.event import (
    TrackTemplate,
    TrackTemplateResult,
    async_track_same_state,
    async_track_template_result,
    async_track_time_interval,
)
from homeassistant.helpers.template import (
    Template,
    TemplateError,
    result_as_boolean,
)
from homeassistant.util import dt as dt_util

from ..const import ConditionType, FeatureName, WorkflowSource
from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from ..domain.runtime import AlertRuntimeState
from ..domain.workflow import (
    ConditionStatus,
    ConditionWorkflowEvent,
)
from ..support.jinja import JinjaEvaluator
from .configuration import Alert, monitor_config


class ConditionWatchers:
    """Own Home Assistant listeners for configured alert conditions."""

    def __init__(
        self,
        hass: HomeAssistant,
        on_condition_result: Callable[
            [str, bool | None, str | None, WorkflowSource], None
        ],
        on_check: Callable[[str, WorkflowSource], None],
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

        monitor = monitor_config(alert)
        unsubscribers: list[Callable[[], None]] = []
        if monitor.on_change:
            if _has_duration_condition(alert):
                unsubscribers.extend(self._track_duration_conditions(alert))
            else:
                unsubscribers.append(
                    self._track_template(
                        compile_condition(alert),
                        lambda active, error, _event: self._on_condition_result(
                            alert_id, active, error, WorkflowSource.CHANGE
                        ),
                    )
                )

        interval = (
            timedelta(seconds=float(monitor.interval))
            if monitor.interval is not None
            else None
        )
        if interval is not None:
            unsubscribers.append(
                self._track_interval(
                    interval,
                    lambda _now: self._on_check(
                        alert_id, WorkflowSource.INTERVAL
                    ),
                )
            )
        confirmation_interval = self._confirmation_interval(alert)
        if confirmation_interval is not None:
            unsubscribers.append(
                self._track_interval(
                    confirmation_interval,
                    lambda _now: self._on_check(
                        alert_id, WorkflowSource.CONFIRMATION
                    ),
                )
            )
        self._unsubscribers[alert_id] = unsubscribers

    def _track_duration_conditions(
        self, alert: dict[str, Any]
    ) -> list[Callable[[], None]]:
        alert_id = str(alert["id"])
        conditions = [
            condition
            for condition in alert.get("conditions", [])
            if isinstance(condition, dict)
            and condition.get("enabled") is not False
            and compile_condition({"conditions": [condition]}, include_for=False)
            != "{{ true }}"
        ]
        values: list[bool | None] = [None] * len(conditions)
        errors: list[str | None] = [None] * len(conditions)
        ready = [not _condition_duration(condition) for condition in conditions]
        timers: dict[tuple[int, str], Callable[[], None]] = {}
        unsubscribers: list[Callable[[], None]] = []

        def emit() -> None:
            active_values = [
                value is True and is_ready
                for value, is_ready in zip(values, ready)
            ]
            operator_any = alert.get("logic") in ("any", "or")
            aggregate = any(active_values) if operator_any else all(active_values)
            if any(errors) and not aggregate:
                error = next(error for error in errors if error is not None)
                self._on_condition_result(
                    alert_id, None, error, WorkflowSource.CHANGE
                )
                return
            self._on_condition_result(
                alert_id, aggregate, None, WorkflowSource.CHANGE
            )

        def condition_membership(
            condition: dict[str, Any], entity_id: str, state: State | None
        ) -> bool:
            if state is None:
                return False
            if condition.get("type") == ConditionType.STATE:
                states = [str(item) for item in _list(condition.get("state")) if item]
                return state.state in states
            if condition.get("type") == ConditionType.NUMERIC:
                try:
                    value = float(state.state)
                except (TypeError, ValueError):
                    value = 0.0
                if condition.get("above") is not None and not value > float(
                    condition["above"]
                ):
                    return False
                if condition.get("below") is not None and not value < float(
                    condition["below"]
                ):
                    return False
                return (
                    condition.get("above") is not None
                    or condition.get("below") is not None
                )
            return False

        def start_timers(index: int, condition: dict[str, Any]) -> None:
            duration = _condition_duration(condition)
            if not duration:
                return
            entity_ids = [
                str(item) for item in _list(condition.get("entity_id")) if item
            ]
            for entity_id in entity_ids:
                key = (index, entity_id)
                if key in timers or not condition_membership(
                    condition, entity_id, self._hass.states.get(entity_id)
                ):
                    continue

                def timer_action(index: int = index) -> None:
                    ready[index] = True
                    emit()

                timers[key] = async_track_same_state(
                    self._hass,
                    timedelta(seconds=duration),
                    timer_action,
                    lambda changed_entity, old_state, new_state: condition_membership(
                        condition, changed_entity, old_state
                    )
                    == condition_membership(condition, changed_entity, new_state),
                    entity_id,
                )

        for index, condition in enumerate(conditions):
            compiled = compile_condition(
                {"conditions": [condition]}, include_for=False
            )

            def on_result(
                active: bool | None,
                error: str | None,
                _event: Event | None,
                index: int = index,
                condition: dict[str, Any] = condition,
            ) -> None:
                values[index] = active
                errors[index] = error
                if active is False:
                    ready[index] = not _condition_duration(condition)
                    for key, unsubscribe in list(timers.items()):
                        if key[0] == index:
                            unsubscribe()
                            del timers[key]
                else:
                    start_timers(index, condition)
                emit()

            unsubscribers.append(self._track_template(compiled, on_result))

        def unsubscribe_timers() -> None:
            for unsubscribe in timers.values():
                unsubscribe()
            timers.clear()

        unsubscribers.append(unsubscribe_timers)
        return unsubscribers

    def unconfigure(self, alert_id: str) -> None:
        for unsubscribe in self._unsubscribers.pop(alert_id, []):
            unsubscribe()


class ConditionFeature(FeatureBase):
    """Own condition compilation, evaluation, and condition watchers."""

    name = "conditions"
    dependencies = (
        "alerts",
        "alert_flow",
        "alert_coordinator",
        "confirmations",
    )

    def __init__(
        self,
        hass: Any,
        _state: Any,
        _config_storage: Any,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._jinja = JinjaEvaluator.for_hass(hass)
        self._alerts: dict[str, Alert] = {}
        self._watchers: ConditionWatchers | None = None
        self._locks: dict[str, asyncio.Lock] = {}
        self._tasks: dict[str, set[asyncio.Task[Any]]] = {}

    def set_alerts(self, alerts: dict[str, Any]) -> None:
        self._alerts = alerts

    async def on_setup(self) -> None:
        alert_feature = self.feature(FeatureName.ALERTS)
        confirmation_feature = self.feature(FeatureName.CONFIRMATIONS)
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

    async def check_alert(
        self, alert_id: str, *, source: WorkflowSource, now: datetime
    ) -> None:
        lock = self._locks.setdefault(alert_id, asyncio.Lock())
        async with lock:
            await self._check(alert_id, source=source, now=now)

    async def evaluate_all(
        self, *, source: WorkflowSource, now: datetime
    ) -> None:
        if self._watchers is None:
            return
        for alert in self._alerts.values():
            if not alert.get("enabled", True):
                continue
            monitor = monitor_config(alert)
            if source == WorkflowSource.STARTUP and monitor.startup is False:
                continue
            await self.check_alert(alert["id"], source=source, now=now)

    async def _configure(self, alert: dict[str, Any]) -> None:
        await self._unconfigure(alert["id"])
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

    async def _check(
        self, alert_id: str, *, source: WorkflowSource, now: datetime
    ) -> None:
        alert = self._alerts.get(alert_id)
        if alert is None or not alert.get("notification"):
            return
        try:
            result = await self._jinja.render(compile_condition(alert))
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
        source: WorkflowSource,
        now: datetime,
    ) -> None:
        alert = self._alerts.get(alert_id)
        if alert is None:
            return
        runtime = self.feature(FeatureName.ALERTS).runtime(alert)
        await self.condition_result_for_alert(
            runtime, active, error, source=source, now=now
        )

    async def condition_result_for_alert(
        self,
        runtime: AlertRuntimeState,
        active: bool | None,
        error: str | None,
        *,
        source: WorkflowSource,
        now: datetime,
    ) -> None:
        """Forward one evaluated result for an explicit alert mapping."""

        alert = runtime.config
        alert_id = str(alert["id"])
        runtime.evaluate(now)
        if error is not None:
            condition_event = ConditionWorkflowEvent(
                runtime, source, now, ConditionStatus.ERROR, error=error
            )
        elif active is False:
            condition_event = ConditionWorkflowEvent(
                runtime, source, now, ConditionStatus.INACTIVE
            )
        elif active is True:
            facts = await self._condition_facts(alert)
            condition_event = ConditionWorkflowEvent(
                runtime,
                source,
                now,
                ConditionStatus.ACTIVE,
                facts=facts or {},
                replace_existing=runtime.condition_active,
            )
            self.feature(FeatureName.ALERTS).activate(runtime, now, source)
        else:
            return
        runtime.record_event(condition_event)
        if condition_event.status is ConditionStatus.ERROR:
            runtime.state["last_error"] = error
        await self.feature(FeatureName.ALERT_COORDINATOR).run(
            alert_id,
            lambda: self.feature(FeatureName.ALERT_FLOW).handle_event(
                condition_event
            ),
        )

    async def condition_result(
        self,
        alert_id: str,
        active: bool | None,
        error: str | None,
        *,
        source: WorkflowSource,
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
                result = await self._jinja.render(
                    compile_condition({"conditions": [condition]})
                )
            except TemplateError:
                result = False
            facts[str(condition_id)] = result_as_boolean(result)
        return facts

    def _schedule_condition_result(
        self,
        alert_id: str,
        active: bool | None,
        error: str | None,
        source: WorkflowSource,
    ) -> None:
        self._schedule_task(
            alert_id,
            self.condition_result(
                alert_id, active, error, source=source, now=dt_util.utcnow()
            ),
        )

    def _schedule_check(self, alert_id: str, source: WorkflowSource) -> None:
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
            result = await self._jinja.render(compile_condition(alert))
        except TemplateError as err:
            error = str(err)
        else:
            result_as_boolean(result)
            error = None
        if error is not None:
            raise ValueError(f"Condition template failed: {error}")
        return True

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


def compile_condition(alert: Any, *, include_for: bool = True) -> str:
    """Compile visual conditions into one Jinja condition."""

    expressions: list[str] = []
    template_blocks: list[str] = []

    for condition in alert.get("conditions", []):
        condition = {"type": ConditionType.TEMPLATE.value, **dict(condition)}
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

            duration = max(0, int(condition.get("for") or 0))
            entity_expressions = []

            for entity_id in entity_ids:
                state_expressions = [
                    f"is_state({json.dumps(entity_id)}, {json.dumps(state)})"
                    for state in states
                ]
                expression = _combine(state_expressions, " or ")

                if duration and include_for:
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
            duration = max(0, int(condition.get("for") or 0))

            for entity_id in entity_ids:
                value = f"states({json.dumps(entity_id)}) | float(0)"
                parts: list[str] = []

                if condition.get("above") is not None:
                    parts.append(f"{value} > {float(condition['above'])}")

                if condition.get("below") is not None:
                    parts.append(f"{value} < {float(condition['below'])}")

                if duration and include_for:
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


def _condition_duration(condition: dict[str, Any]) -> int:
    if condition.get("type") not in (
        ConditionType.STATE,
        ConditionType.NUMERIC,
    ):
        return 0
    return max(0, int(condition.get("for") or 0))


def _has_duration_condition(alert: dict[str, Any]) -> bool:
    return any(
        _condition_duration(condition) > 0
        for condition in alert.get("conditions", [])
        if isinstance(condition, dict) and condition.get("enabled") is not False
    )
