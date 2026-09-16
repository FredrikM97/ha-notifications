"""Evaluate alert conditions and return trigger transitions."""

from __future__ import annotations

import inspect
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol, cast

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.event import (
    TrackTemplate,
    TrackTemplateResult,
    async_track_template_result,
    async_track_time_interval,
)
from homeassistant.helpers.template import Template, TemplateError, result_as_boolean
from homeassistant.util import dt as dt_util
from pydantic import ConfigDict, field_validator

from ..const import StateRoot, TransitionKind
from ..controller.lifecycle import FeatureBase, route
from ..domain.durations import duration_seconds
from .conditions import compile_condition
from .confirmation import confirmation_for_alert
from .feature_config import AlertFeatureConfig
from .notification import NotificationConfig, NotificationSchedule
from .trigger_effects import TriggerTransitionEffects


class MonitorConfig(AlertFeatureConfig):
    """Validated watcher settings owned by the triggering feature."""

    model_config = ConfigDict(extra="allow")

    on_change: bool | None = None
    startup: bool | None = None
    interval: int | float | None = None

    @field_validator("interval", mode="before")
    @classmethod
    def _normalize_interval(cls, value: Any) -> Any:
        return duration_seconds(value)


class ConfirmationWorkflow(Protocol):
    """Confirmation operations used by trigger evaluation."""

    async def prepare_action(
        self, alert: dict[str, Any], runtime: dict[str, Any]
    ) -> tuple[bool, str | None]: ...

    async def track(
        self, session_id: str, *, now: datetime, alert_id: str
    ) -> None: ...


@dataclass(frozen=True)
class TriggerTransition:
    """What happened to one alert's condition, and what `core.py` should do."""

    kind: TransitionKind
    error: str | None = None
    source: str = ""
    replace_existing: bool = False
    had_pending_confirmation: bool = False
    attempt: int = 0
    confirmation_action_id: str | None = None
    new_confirmation_action: bool = False


class TriggerWatchers:
    """Own Home Assistant listeners for one alert's trigger configuration."""

    def __init__(
        self,
        hass: HomeAssistant,
        on_condition_result: Callable[
            [str, bool | None, str | None, str], None
        ],
        on_check: Callable[[str, str], None],
    ) -> None:
        self._hass = hass
        self._on_condition_result = on_condition_result
        self._on_check = on_check
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
        """Replace listeners for one alert."""

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

        schedule = NotificationSchedule(
            NotificationConfig.model_validate(alert["notification"]),
            confirmation_for_alert(alert),
        )
        interval = schedule.check_interval(monitor.interval)
        if interval is not None:
            unsubscribers.append(
                self._track_interval(
                    interval,
                    lambda _now: self._on_check(alert_id, "interval"),
                )
            )
        confirmation_interval = schedule.confirmation_interval()
        if confirmation_interval is not None:
            unsubscribers.append(
                self._track_interval(
                    confirmation_interval,
                    lambda _now: self._on_check(alert_id, "confirmation"),
                )
            )
        self._unsubscribers[alert_id] = unsubscribers

    def unconfigure(self, alert_id: str) -> None:
        """Remove listeners for one alert."""

        for unsubscribe in self._unsubscribers.pop(alert_id, []):
            unsubscribe()


class TriggeringWorkflow:
    """Typed orchestration for watcher callbacks and one-shot checks."""

    def __init__(
        self,
        hass: HomeAssistant,
        alerts: dict[str, dict[str, Any]],
        runtime_for: Callable[[str], dict[str, Any]],
        on_transition: Callable[
            [dict[str, Any], TriggerTransition, datetime], Awaitable[None]
        ],
        prepare_confirmation: Callable[
            [dict[str, Any], dict[str, Any]], Awaitable[tuple[bool, str | None]]
        ],
    ) -> None:
        self._hass = hass
        self._alerts = alerts
        self._runtime_for = runtime_for
        self._on_transition = on_transition
        self._prepare_confirmation = prepare_confirmation
        self._watchers = TriggerWatchers(
            hass,
            self._schedule_condition_result,
            self._schedule_check,
        )

    async def _evaluate_condition(
        self, source: str
    ) -> tuple[bool | None, str | None]:
        template = Template(source, self._hass)
        try:
            result = template.async_render(parse_result=True, strict=False)
            if inspect.isawaitable(result):
                result = await result
        except TemplateError as err:
            return None, str(err)
        return result_as_boolean(result), None

    def set_alerts(self, alerts: dict[str, dict[str, Any]]) -> None:
        """Point the workflow at the controller's current alert mapping."""

        self._alerts = alerts

    @staticmethod
    def _transition_for(
        state: dict[str, Any],
        alert: dict[str, Any],
        active: bool | None,
        error: str | None,
        now: datetime,
        source: str,
        confirmation_action: tuple[bool, str | None],
    ) -> TriggerTransition:
        if error is not None:
            return TriggerTransition(
                kind=TransitionKind.CONDITION_ERROR, error=error, source=source
            )
        state["last_evaluated"] = now.isoformat()
        if not active:
            return TriggeringWorkflow._inactive_transition(state, source)
        if not state.get("active", False):
            return TriggeringWorkflow._active_transition(
                state, alert, now, source, confirmation_action
            )
        if state.get("acknowledged", False):
            return TriggerTransition(kind=TransitionKind.NO_CHANGE, source=source)
        attempts = int(state.get("attempts", 0))
        has_sent = bool(state.get("last_notified") or attempts)
        monitor = MonitorConfig.model_validate(alert.get("monitor", {}))
        schedule = NotificationSchedule(
            NotificationConfig.model_validate(alert["notification"]),
            confirmation_for_alert(alert),
        )
        if source == "startup" and monitor.startup and not has_sent:
            return TriggeringWorkflow._send_transition(
                state, alert, source, False, confirmation_action
            )
        if source == "enabled" and not has_sent:
            return TriggeringWorkflow._send_transition(
                state, alert, source, False, confirmation_action
            )
        if source in (
            "reload",
            "startup",
            "interval",
            "confirmation",
        ) and schedule.is_due(state, now):
            return TriggeringWorkflow._send_transition(
                state, alert, source, True, confirmation_action
            )
        return TriggerTransition(kind=TransitionKind.NO_CHANGE, source=source)

    @staticmethod
    def _inactive_transition(
        state: dict[str, Any], source: str
    ) -> TriggerTransition:
        if not state.get("active", False):
            return TriggerTransition(kind=TransitionKind.NO_CHANGE, source=source)
        had_pending_confirmation = bool(state.get("confirmation_action_id"))
        state.update(
            active=False,
            acknowledged=False,
            attempts=0,
            confirmation_action_id=None,
            notification_id=None,
            flow_id=None,
        )
        return TriggerTransition(
            kind=TransitionKind.BECAME_INACTIVE,
            source=source,
            had_pending_confirmation=had_pending_confirmation,
        )

    @staticmethod
    def _active_transition(
        state: dict[str, Any],
        alert: dict[str, Any],
        now: datetime,
        source: str,
        confirmation_action: tuple[bool, str | None],
    ) -> TriggerTransition:
        state.update(
            active=True,
            acknowledged=False,
            attempts=0,
            started_at=now.isoformat(),
            notification_id=f"ha_notifications_{alert['id']}_{uuid.uuid4().hex[:10]}",
        )
        TriggeringWorkflow._ensure_flow_id(state, alert)
        new_action, action_id = confirmation_action
        return TriggerTransition(
            kind=TransitionKind.BECAME_ACTIVE,
            source=source,
            attempt=1,
            confirmation_action_id=action_id,
            new_confirmation_action=new_action,
        )

    @staticmethod
    def _send_transition(
        state: dict[str, Any],
        alert: dict[str, Any],
        source: str,
        replace_existing: bool,
        confirmation_action: tuple[bool, str | None],
    ) -> TriggerTransition:
        TriggeringWorkflow._ensure_flow_id(state, alert)
        new_action, action_id = confirmation_action
        return TriggerTransition(
            kind=TransitionKind.SHOULD_SEND,
            source=source,
            replace_existing=replace_existing,
            attempt=int(state.get("attempts", 0)) + 1,
            confirmation_action_id=action_id,
            new_confirmation_action=new_action,
        )

    @staticmethod
    def _ensure_flow_id(state: dict[str, Any], alert: dict[str, Any]) -> None:
        if not state.get("flow_id"):
            state["flow_id"] = f"flow_{alert['id']}_{uuid.uuid4().hex[:8]}"

    @staticmethod
    def record_send_result(
        state: dict[str, Any],
        attempt: int,
        now: datetime,
        *,
        success: bool,
        error: str | None = None,
    ) -> None:
        if not success:
            state["last_error"] = error
            return
        state["attempts"] = attempt
        state["last_notified"] = now.isoformat()
        state["last_error"] = None

    async def configure(self, alert: dict[str, Any]) -> None:
        """Replace an alert's template and interval watchers."""

        alert_id = alert["id"]
        self._runtime_for(alert_id)
        self._watchers.configure(alert)

    def unconfigure(self, alert_id: str) -> None:
        """Remove direct watchers for one alert."""

        self._watchers.unconfigure(alert_id)

    async def check(self, alert_id: str, *, source: str, now: datetime) -> None:
        """Evaluate one configured alert and apply its transition."""

        alert = self._alerts.get(alert_id)
        if alert is None or not alert.get("notification"):
            return
        active, error = await self._evaluate_condition(compile_condition(alert))
        await self.condition_result(alert_id, active, error, source=source, now=now)

    async def condition_result(
        self,
        alert_id: str,
        active: bool | None,
        error: str | None,
        *,
        source: str,
        now: datetime,
    ) -> None:
        """Apply a known condition result and dispatch ordered effects."""

        alert = self._alerts.get(alert_id)
        if alert is None:
            return
        runtime = self._runtime_for(alert_id)
        confirmation_action = await self._prepare_confirmation(alert, runtime)
        transition = self._transition_for(
            runtime,
            alert,
            active,
            error,
            now,
            source,
            confirmation_action,
        )
        await self._on_transition(alert, transition, now)

    def _schedule_condition_result(
        self,
        alert_id: str,
        active: bool | None,
        error: str | None,
        source: str,
    ) -> None:
        self._hass.async_create_task(
            self.condition_result(
                alert_id,
                active,
                error,
                source=source,
                now=dt_util.utcnow(),
            )
        )

    def _schedule_check(self, alert_id: str, source: str) -> None:
        self._hass.async_create_task(
            self.check(
                alert_id,
                source=source,
                now=dt_util.utcnow(),
            )
        )


class TriggeringFeature(FeatureBase):
    """Lifecycle adapter that gives watcher ownership to triggering."""

    name = "triggering"
    dependencies = (
        "alerts",
        "confirmation",
        "notification",
        "follow_up_actions",
        "history",
    )

    def __init__(self, hass: HomeAssistant, state: StateRoot, *_args: Any) -> None:
        super().__init__(hass, state, *_args)
        self._hass = hass
        self._state = state
        self._workflow: TriggeringWorkflow | None = None
        self._alerts: dict[str, dict[str, Any]] = {}
        self._confirmation: ConfirmationWorkflow | None = None
        self._effects: TriggerTransitionEffects | None = None

    def set_alerts(self, alerts: dict[str, dict[str, Any]]) -> None:
        mapped_alerts = {
            alert.id: alert.model_dump(exclude_none=True)
            for alert in alerts.values()
        }
        self._alerts = mapped_alerts
        if self._workflow:
            self._workflow.set_alerts(mapped_alerts)

    def mark_confirmed(
        self, runtime: dict[str, Any], confirmed_by: str, now: datetime
    ) -> None:
        """Update trigger runtime after its confirmation has resolved."""

        runtime["acknowledged"] = True
        runtime["confirmation_action_id"] = None
        runtime["confirmed_at"] = now.isoformat()
        runtime["confirmed_by"] = confirmed_by

    async def on_setup(self) -> None:
        alert_feature = self.feature("alerts")
        self._confirmation = cast(
            ConfirmationWorkflow, self.feature("confirmation")
        )
        self._effects = TriggerTransitionEffects(
            runtime_for=alert_feature.runtime,
            confirmation=self._confirmation,
            notification=self.feature("notification"),
            follow_up_actions=self.feature("follow_up_actions"),
            history=self.feature("history"),
            hass=self._hass,
            record_send_result=TriggeringWorkflow.record_send_result,
        )
        self._workflow = TriggeringWorkflow(
            self._hass,
            {},
            alert_feature.runtime,
            self._handle_transition,
            self._confirmation.prepare_action,
        )
        self.set_alerts(alert_feature.alerts)
        for alert in self._alerts.values():
            await self._workflow.configure(alert)

    async def _handle_transition(
        self, alert: dict[str, Any], transition: TriggerTransition, now: datetime
    ) -> None:
        """Delegate ordered effects after the transition decision."""

        if self._effects is not None:
            await self._effects.apply(alert, transition, now)

    @route("alerts.check")
    async def check_alert(self, alert_id: str, *, source: str, now: datetime) -> None:
        """Evaluate one configured alert through its feature-owned workflow."""

        if self._workflow is None:
            return
        await self._workflow.check(alert_id, source=source, now=now)

    @route("alerts.evaluate_all")
    async def evaluate_all(self, *, source: str, now: datetime) -> None:
        """Evaluate eligible alerts for a lifecycle-triggered source."""

        for alert in self._alerts.values():
            if not alert.get("enabled", True):
                continue
            monitor = alert.get("monitor") or {}
            if source == "startup" and not monitor.get("startup", True):
                continue
            await self.check_alert(alert["id"], source=source, now=now)

    async def on_unload(self) -> None:
        if self._workflow is None:
            return
        for alert_id in tuple(self._alerts):
            self._workflow.unconfigure(alert_id)
        self._workflow = None
