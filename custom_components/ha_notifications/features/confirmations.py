"""Track confirmation sessions and route response events."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from homeassistant.util import dt as dt_util
from pydantic import BaseModel, ConfigDict, Field

from ..const import (
    EVENT_NOTIFICATION_ACTION,
    AlertEventType,
    FeatureName,
)
from ..controller.lifecycle import FeatureBase
from ..domain.confirmation import (
    ConfirmationContext,
    ConfirmationSelection,
)
from ..domain.runtime import AlertRuntimeState
from ..domain.service_calls import FollowUpActionsRequest
from ..domain.workflow import ConfirmationWorkflowEvent, NotificationRequest
from ..support.jinja import JinjaEvaluator


class ConfirmationNotificationConfig(BaseModel):
    """Notification sent after a confirmation is received."""

    enabled: bool = False
    message: str | None = None
    clear: bool = True


class ConfirmationReminderConfig(BaseModel):
    """Reminder policy for a pending confirmation."""

    enabled: bool = True
    interval: int | float | None = 1800
    max_attempts: int = 5
    show_attempts: bool = False
    timeout: int | float | None = 900


class ConfirmationButtonConfig(BaseModel):
    """One response button shown on a confirmation notification."""

    id: str
    label: str


def default_confirmation_buttons() -> list[ConfirmationButtonConfig]:
    """Return the canonical default response for enabled confirmations."""

    return [ConfirmationButtonConfig(id="confirm", label="Done")]


class ConfirmationConfig(BaseModel):
    """Validated confirmation prompt and its owned follow-up settings."""

    model_config = ConfigDict(extra="allow")

    enabled: bool | None = None
    buttons: list[ConfirmationButtonConfig] = Field(
        default_factory=default_confirmation_buttons
    )
    notification: ConfirmationNotificationConfig = Field(
        default_factory=ConfirmationNotificationConfig
    )
    reminders: ConfirmationReminderConfig = Field(
        default_factory=ConfirmationReminderConfig
    )
    @classmethod
    def from_alert(cls, alert: Mapping[str, Any]) -> ConfirmationConfig | None:
        """Read confirmation configuration from an alert boundary."""

        value = alert.get("confirmation")
        if value is None:
            return None
        return cls.model_validate(value)


@dataclass(slots=True)
class ConfirmationSession:
    """Mutable runtime state for one pending confirmation action."""

    runtime: AlertRuntimeState
    selection: ConfirmationSelection


@dataclass(frozen=True, slots=True)
class ConfirmationAttemptsExhausted:
    """Describe confirmation action expiry after the reminder limit."""

    attempts: int
    max_attempts: int


class ConfirmationFeature(FeatureBase):
    """Own response-action sessions and the Home Assistant subscription."""

    name = "confirmations"
    dependencies = (
        "alerts",
        "alert_coordinator",
        "notification",
        "follow_up_actions",
    )
    SESSION_TTL = timedelta(days=7)

    @classmethod
    def create(
        cls,
        hass: Any,
        _runtime: dict[str, AlertRuntimeState],
        _storage: Any,
    ) -> ConfirmationFeature:
        """Construct confirmations without unrelated shared services."""

        return cls(hass)

    def __init__(self, hass: Any) -> None:
        super().__init__()
        self._hass = hass
        self._jinja = JinjaEvaluator.for_hass(hass)
        self._sessions: dict[str, ConfirmationSession] = {}
        self._unsubscribe: Callable[[], None] | None = None

    async def on_setup(self) -> None:
        self._unsubscribe = self._hass.bus.async_listen(
            EVENT_NOTIFICATION_ACTION, self._on_action_event
        )

    async def on_unload(self) -> None:
        if self._unsubscribe:
            self._unsubscribe()
            self._unsubscribe = None
        self._sessions.clear()

    @staticmethod
    def reminder_interval(alert: dict[str, Any]) -> timedelta | None:
        """Return the configured reminder interval for an alert."""

        settings = ConfirmationConfig.from_alert(alert)
        if settings is None or not settings.enabled or not settings.reminders.enabled:
            return None
        if settings.reminders.interval is None:
            return None
        return timedelta(seconds=float(settings.reminders.interval))

    @staticmethod
    def reminder_due(
        runtime: AlertRuntimeState, now: datetime
    ) -> bool:
        """Decide whether a pending confirmation should be resent."""

        alert = runtime.config
        pending = runtime.confirmation
        if not pending.action_ids:
            return False
        settings = ConfirmationConfig.from_alert(alert)
        if settings is None or not settings.enabled or not settings.reminders.enabled:
            return False
        if pending.attempts >= int(settings.reminders.max_attempts or 1):
            return False
        last_notified = runtime.last_notified
        if not last_notified:
            return True
        try:
            previous = datetime.fromisoformat(str(last_notified))
        except ValueError:
            return True
        interval = (
            timedelta(seconds=float(settings.reminders.interval))
            if settings.reminders.interval is not None
            else None
        )
        return interval is None or now - previous >= interval

    @staticmethod
    def record_attempt(runtime: AlertRuntimeState) -> None:
        """Commit one delivered confirmation reminder attempt."""

        runtime.confirmation.attempts += 1

    def expire_stale(
        self,
        runtime: AlertRuntimeState,
        now: datetime,
    ) -> bool:
        """Expire persisted response sessions that exceed the ownership TTL."""

        action_ids = runtime.confirmation.action_ids
        if not action_ids:
            return False
        timestamp = (
            runtime.last_notified or runtime.started_at
        )
        if not timestamp:
            return False
        try:
            created_at = datetime.fromisoformat(str(timestamp))
        except ValueError:
            return False
        if now - created_at < self.SESSION_TTL:
            return False
        expired_action_ids = tuple(runtime.confirmation.action_ids)
        runtime.confirmation.action_ids.clear()
        for action_id in expired_action_ids:
            self.clear(action_id)
        return True

    def expire_exhausted(
        self,
        runtime: AlertRuntimeState,
    ) -> ConfirmationAttemptsExhausted | None:
        """Expire pending actions and report the confirmation limit reached."""

        alert = runtime.config
        if not runtime.confirmation.action_ids:
            return None
        settings = ConfirmationConfig.from_alert(alert)
        if (
            settings is None
            or not settings.enabled
            or not settings.reminders.enabled
            or runtime.confirmation.attempts < settings.reminders.max_attempts
        ):
            return None
        expired_action_ids = tuple(runtime.confirmation.action_ids)
        runtime.confirmation.action_ids.clear()
        for action_id in expired_action_ids:
            self.clear(action_id)
        return ConfirmationAttemptsExhausted(
            attempts=runtime.confirmation.attempts,
            max_attempts=settings.reminders.max_attempts,
        )

    async def _on_action_event(self, event: Any) -> None:
        result = await self.resolve_action_event(event)
        if result:
            await self.feature(FeatureName.ALERT_COORDINATOR).run(
                str(result.runtime.config["id"]),
                lambda: self._apply_confirmation(result),
            )

    async def _apply_confirmation(self, result: ConfirmationResult) -> None:
        """Apply one resolved confirmation and all of its ordered effects."""

        runtime = result.runtime
        alert = runtime.config
        self._acknowledge(result)
        alerts = self.feature(FeatureName.ALERTS)
        alerts.publish_event(
            runtime,
            AlertEventType.CONFIRMED,
            "Notification confirmed.",
            {
                "confirmed_by": result.confirmation.confirmed_by,
                "response_id": result.confirmation.selection.response_id,
                "response": result.confirmation.selection.label,
            },
        )
        # notification imports ConfirmationConfig, so defer this cycle-breaking
        # import until the confirmation workflow is executed.
        from .notification import ConfirmationDeliveryPlanner

        delivery = await ConfirmationDeliveryPlanner(
            alert,
            result.confirmation,
            result.now,
        ).build(self._render_template)
        if delivery.clear_notification:
            await self.feature(FeatureName.NOTIFICATION).clear(runtime)
        if delivery.completion_alert is not None:
            await self._send_completion(
                runtime, delivery.completion_alert, result.now
            )
        actions = self.feature(FeatureName.FOLLOW_UP_ACTIONS).actions_for_confirmation(
            runtime
        )
        await self.feature(FeatureName.FOLLOW_UP_ACTIONS).execute(
            FollowUpActionsRequest(
                runtime,
                actions=tuple(actions),
                confirmation=result.confirmation,
            )
        )
    def _acknowledge(self, result: ConfirmationResult) -> None:
        """Record confirmation-owned response state."""

        runtime = result.runtime
        runtime.confirmation.action_ids.clear()
        runtime.state.update(
            acknowledged=True,
            confirmed_at=result.now.isoformat(),
            confirmed_by=result.confirmation.confirmed_by,
        )
        runtime.record_event(
            ConfirmationWorkflowEvent(
                runtime=runtime,
                confirmation=result.confirmation,
                now=result.now,
            )
        )

    async def _send_completion(
        self,
        runtime: AlertRuntimeState,
        completion_alert: Mapping[str, Any],
        now: datetime,
    ) -> None:
        """Send and record the optional completion notification."""

        completion_runtime = AlertRuntimeState.for_alert(completion_alert)
        outcome = await self.feature(FeatureName.NOTIFICATION).send(
            NotificationRequest(
                runtime=completion_runtime,
                replace_existing=False,
            )
        )
        self.feature(FeatureName.ALERTS).publish_event(
            runtime,
            AlertEventType.COMPLETION_SENT
            if outcome.success
            else AlertEventType.COMPLETION_FAILED,
            "Completion notification sent."
            if outcome.success
            else "Completion notification failed.",
            {} if outcome.success else {"error": outcome.error},
        )

    async def _render_template(
        self, source: str, variables: dict[str, Any] | None = None
    ) -> Any:
        return await self._jinja.render(source, variables)

    def track(
        self,
        session_id: str,
        *,
        runtime: AlertRuntimeState,
        selection: ConfirmationSelection | None = None,
    ) -> None:
        """Track a pending confirmation owned by this feature."""

        self._sessions[session_id] = ConfirmationSession(
            runtime=runtime,
            selection=selection
            or ConfirmationSelection(session_id, "confirm", "Done"),
        )

    def clear(self, session_id: str) -> None:
        """Stop tracking one pending confirmation."""

        self._sessions.pop(session_id, None)

    def _clear_related(self, session: ConfirmationSession) -> None:
        """Stop tracking every response belonging to the same confirmation."""

        related_ids = [
            session_id
            for session_id, candidate in self._sessions.items()
            if candidate.runtime.config["id"] == session.runtime.config["id"]
        ]
        for session_id in related_ids:
            self.clear(session_id)

    def has_pending(self, session_id: str) -> bool:
        """Return whether a confirmation session is still pending."""

        return session_id in self._sessions

    def rebuild(self, runtimes: Mapping[str, AlertRuntimeState]) -> None:
        """Restore pending saved-alert confirmations from runtime state."""

        self._sessions.clear()
        for state in runtimes.values():
            action_ids = state.confirmation.action_ids
            selections = self.selections_for(
                state.config,
                action_ids,
            )
            for selection in selections:
                self.track(
                    selection.action_id,
                    runtime=state,
                    selection=selection,
                )

    async def resolve_action_event(self, event: Any) -> ConfirmationResult | None:
        """Resolve a Home Assistant action event to one typed confirmation fact."""

        event_data = event.data
        action_id = extract_action_id(event_data)
        if not action_id:
            return None

        now = dt_util.utcnow()
        session = self._sessions.get(action_id)
        if session is None:
            return None

        user_id = event.context.user_id if event.context else None
        confirmed_by = await resolve_confirmed_by(
            self._hass,
            self._hass.states.async_all("person"),
            user_id,
        )

        state = session.runtime
        if (
            action_id not in state.confirmation.action_ids
        ):
            return None

        self._clear_related(session)
        return ConfirmationResult(
            state,
            ConfirmationContext(confirmed_by, session.selection),
            now,
        )

    def selections_for(
        self, alert: Mapping[str, Any], action_ids: Mapping[str, str]
    ) -> tuple[ConfirmationSelection, ...]:
        """Resolve persisted action IDs into immutable response selections."""

        settings = ConfirmationConfig.from_alert(alert)
        labels = {
            button.id: button.label
            for button in settings.buttons
        } if settings else {}
        return tuple(
            ConfirmationSelection(
                str(action_id),
                str(response_id),
                labels.get(str(response_id), "Done"),
            )
            for action_id, response_id in action_ids.items()
        )

    def pending_actions(
        self, runtime: AlertRuntimeState
    ) -> tuple[ConfirmationSelection, ...]:
        """Return prepared notification actions for one pending alert."""

        alert = runtime.config
        action_ids = runtime.confirmation.action_ids
        return self.selections_for(alert, action_ids)

    def prepare_action(
        self,
        runtime: AlertRuntimeState,
    ) -> None:
        """Create a pending action only when confirmation is configured."""

        alert = runtime.config
        confirmation = ConfirmationConfig.model_validate(
            alert.get("confirmation") or {}
        )
        if not confirmation.enabled:
            return
        pending = runtime.confirmation
        existing = pending.action_ids
        if existing:
            for selection in self.selections_for(alert, existing):
                self.track(
                    selection.action_id,
                        runtime=runtime,
                    selection=selection,
                )
            return
        self.begin_pending_response(runtime, confirmation)

    def begin_pending_response(
        self,
        runtime: AlertRuntimeState,
        confirmation: ConfirmationConfig,
    ) -> None:
        """Create and track the canonical pending response session."""

        alert = runtime.config
        action_ids = {
            f"NC_CONFIRM_{alert['id']}_{uuid4().hex}_{button.id}": button.id
            for button in confirmation.buttons
        }
        runtime.confirmation.action_ids = action_ids
        runtime.confirmation.attempts = 0
        for selection in self.selections_for(alert, action_ids):
            self.track(
                selection.action_id,
                    runtime=runtime,
                selection=selection,
            )

# ----------------------------------------------------------------------


@dataclass(frozen=True)
class ConfirmationResult:
    """Resolved action with its canonical runtime aggregate."""

    runtime: AlertRuntimeState
    confirmation: ConfirmationContext
    now: datetime


def extract_action_id(event_data: Any) -> str | None:
    """Return the confirmation action ID from a mobile-action event payload."""

    if not isinstance(event_data, Mapping):
        return None

    action = event_data.get("action")
    return str(action) if action else None


# ----------------------------------------------------------------------
# Person name resolution
# ----------------------------------------------------------------------


def resolve_person_name(person_states: list[Any], user_id: str | None) -> str:
    """Resolve a Home Assistant user ID to a person's display name."""

    if not user_id:
        return "Unknown user"

    for state in person_states:
        if state.attributes.get("user_id") == user_id:
            name = getattr(state, "name", "")
            if name:
                return name

    return "Unknown user"


async def resolve_confirmed_by(
    hass: Any, person_states: list[Any], user_id: str | None
) -> str:
    """Resolve a confirmation user through person state or HA auth."""

    person_name = resolve_person_name(person_states, user_id)
    if person_name != "Unknown user" or not user_id:
        return person_name

    user = await hass.auth.async_get_user(user_id)
    if user and user.name:
        return user.name
    return "Unknown user"

