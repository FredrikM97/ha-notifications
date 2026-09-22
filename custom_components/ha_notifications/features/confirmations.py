"""Track confirmation sessions and route response events."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from homeassistant.util import dt as dt_util
from pydantic import BaseModel, ConfigDict, Field

from ..const import EVENT_NOTIFICATION_ACTION, STATE_RUNTIME, StateRoot
from ..controller.lifecycle import FeatureBase
from ..domain.confirmation import (
    ConfirmationActionSet,
    ConfirmationContext,
    ConfirmationSelection,
    PendingConfirmationState,
)
from ..domain.runtime import AlertRuntimeState


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


class ConfirmationSession(BaseModel):
    """Mutable runtime state for one pending confirmation action."""

    model_config = ConfigDict(extra="forbid")

    alert_id: str | None = None
    selection: ConfirmationSelection
    created_at: datetime


class ConfirmationFeature(FeatureBase):
    """Own response-action sessions and the Home Assistant subscription."""

    name = "confirmations"
    dependencies = ("alerts",)
    SESSION_TTL = timedelta(days=7)

    def __init__(
        self,
        hass: Any,
        state: StateRoot,
        _config_storage: Any,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._state = state
        self._sessions: dict[str, ConfirmationSession] = {}
        self._alerts: dict[str, Any] = {}
        self._unsubscribe: Callable[[], None] | None = None

    async def on_setup(self) -> None:
        self._alerts = self.feature("alerts").alerts
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
        alert: dict[str, Any], runtime: dict[str, Any], now: datetime
    ) -> bool:
        """Decide whether a pending confirmation should be resent."""

        pending = PendingConfirmationState.from_runtime(runtime)
        if not pending.action_ids:
            return False
        settings = ConfirmationConfig.from_alert(alert)
        if settings is None or not settings.enabled or not settings.reminders.enabled:
            return False
        if pending.attempts >= int(settings.reminders.max_attempts or 1):
            return False
        last_notified = runtime.get("last_notified")
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
    def next_attempt(runtime: dict[str, Any]) -> int:
        """Return the next confirmation reminder attempt."""

        return PendingConfirmationState.from_runtime(runtime).attempts + 1

    @staticmethod
    def record_attempt(runtime: dict[str, Any]) -> None:
        """Commit one delivered confirmation reminder attempt."""

        state = AlertRuntimeState.from_runtime(runtime)
        state.confirmation.attempts += 1
        state.write_to(runtime)

    def acknowledge(
        self, alert_id: str, confirmed_by: str, now: datetime
    ) -> None:
        """Complete the response-owned acknowledgement state."""

        runtime = self._state[STATE_RUNTIME].get(alert_id)
        if runtime is None:
            return
        state = AlertRuntimeState.from_runtime(runtime)
        state.confirmation.action_ids.clear()
        state.acknowledged = True
        state.confirmed_at = now.isoformat()
        state.confirmed_by = confirmed_by
        state.write_to(runtime)

    def expire_stale(
        self,
        runtime: dict[str, Any],
        now: datetime,
    ) -> bool:
        """Expire persisted response sessions that exceed the ownership TTL."""

        state = AlertRuntimeState.from_runtime(runtime)
        action_ids = state.confirmation.action_ids
        if not action_ids:
            return False
        timestamp = state.last_notified or state.started_at
        if not timestamp:
            return False
        try:
            created_at = datetime.fromisoformat(str(timestamp))
        except ValueError:
            return False
        if now - created_at < self.SESSION_TTL:
            return False
        expired_action_ids = tuple(state.confirmation.action_ids)
        state.confirmation.action_ids.clear()
        state.write_to(runtime)
        for action_id in expired_action_ids:
            self.clear(action_id)
        return True

    def expire_exhausted(
        self,
        alert: Mapping[str, Any],
        runtime: dict[str, Any],
    ) -> bool:
        """Expire pending confirmation actions after the reminder limit."""

        state = AlertRuntimeState.from_runtime(runtime)
        if not state.confirmation.action_ids:
            return False
        settings = ConfirmationConfig.from_alert(alert)
        if (
            settings is None
            or not settings.enabled
            or not settings.reminders.enabled
            or state.confirmation.attempts < settings.reminders.max_attempts
        ):
            return False
        expired_action_ids = tuple(state.confirmation.action_ids)
        state.confirmation.action_ids.clear()
        state.write_to(runtime)
        for action_id in expired_action_ids:
            self.clear(action_id)
        return True

    async def _on_action_event(self, event: Any) -> None:
        result = await self.resolve_action_event(event)
        if result:
            await self.feature("alert_flow").handle_confirmation(result)

    def track(
        self,
        session_id: str,
        *,
        now: datetime,
        alert_id: str,
        selection: ConfirmationSelection | None = None,
    ) -> None:
        """Track a pending confirmation owned by this feature."""

        self._sessions[session_id] = ConfirmationSession(
            alert_id=alert_id,
            selection=selection
            or ConfirmationSelection(session_id, "confirm", "Done"),
            created_at=now,
        )

    def clear(self, session_id: str) -> None:
        """Stop tracking one pending confirmation."""

        self._sessions.pop(session_id, None)

    def _clear_related(self, session: ConfirmationSession) -> None:
        """Stop tracking every response belonging to the same confirmation."""

        related_ids = [
            session_id
            for session_id, candidate in self._sessions.items()
            if (
                session.alert_id is not None
                and candidate.alert_id == session.alert_id
            )
        ]
        for session_id in related_ids:
            self.clear(session_id)

    def has_pending(self, session_id: str) -> bool:
        """Return whether a confirmation session is still pending."""

        return session_id in self._sessions

    def rebuild(self) -> None:
        """Restore pending saved-alert confirmations from runtime state."""

        self._sessions.clear()
        now = dt_util.utcnow()
        for alert_id, state in self._state[STATE_RUNTIME].items():
            action_ids = PendingConfirmationState.from_runtime(state).action_ids
            alert = self._alerts.get(alert_id)
            selections = self.selections_for(
                alert or {},
                action_ids,
            )
            for selection in selections:
                self.track(
                    selection.action_id,
                    now=now,
                    alert_id=alert_id,
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

        if session.alert_id is None:
            return None
        alert = self._alerts.get(session.alert_id)
        state = self._state[STATE_RUNTIME].get(session.alert_id)
        if (
            alert is None
            or state is None
            or action_id
            not in PendingConfirmationState.from_runtime(state).action_ids
        ):
            return None

        self._clear_related(session)
        return ConfirmationResult(
            alert,
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
        self, alert: Mapping[str, Any], runtime: dict[str, Any]
    ) -> ConfirmationActionSet:
        """Return prepared notification actions for one pending alert."""

        action_ids = PendingConfirmationState.from_runtime(runtime).action_ids
        return ConfirmationActionSet(self.selections_for(alert, action_ids))

    def prepare_action(
        self,
        alert: Mapping[str, Any],
        runtime: dict[str, Any],
        *,
        now: datetime | None = None,
    ) -> None:
        """Create a pending action only when confirmation is configured."""

        confirmation = ConfirmationConfig.model_validate(
            alert.get("confirmation") or {}
        )
        if not confirmation.enabled:
            return
        pending = PendingConfirmationState.from_runtime(runtime)
        existing = pending.action_ids
        if existing:
            if now is not None:
                for selection in self.selections_for(alert, existing):
                    self.track(
                        selection.action_id,
                        now=now,
                        alert_id=str(alert["id"]),
                        selection=selection,
                    )
            return
        self.begin_pending_response(alert, runtime, confirmation, now=now)

    def begin_pending_response(
        self,
        alert: Mapping[str, Any],
        runtime: dict[str, Any],
        confirmation: ConfirmationConfig,
        *,
        now: datetime | None = None,
    ) -> None:
        """Create and track the canonical pending response session."""

        action_ids = {
            f"NC_CONFIRM_{alert['id']}_{uuid4().hex}_{button.id}": button.id
            for button in confirmation.buttons
        }
        state = AlertRuntimeState.from_runtime(runtime)
        state.confirmation.action_ids = action_ids
        state.confirmation.attempts = 0
        state.write_to(runtime)
        if now is not None:
            for selection in self.selections_for(alert, action_ids):
                self.track(
                    selection.action_id,
                    now=now,
                    alert_id=str(alert["id"]),
                    selection=selection,
                )

# ----------------------------------------------------------------------


@dataclass(frozen=True)
class ConfirmationResult:
    """Resolved action with the alert data needed by the controller."""

    alert: Mapping[str, Any]
    confirmation: ConfirmationContext
    now: datetime


def extract_action_id(event_data: Any) -> str | None:
    """Return the confirmation action ID from a mobile-action event payload."""

    if not isinstance(event_data, dict):
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

