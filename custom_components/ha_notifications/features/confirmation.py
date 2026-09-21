"""Track confirmation sessions and route response events."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from homeassistant.util import dt as dt_util
from pydantic import BaseModel, ConfigDict, Field

from ..const import EVENT_NOTIFICATION_ACTION, STATE_RUNTIME, StateRoot
from ..controller.lifecycle import FeatureBase
from ..domain.durations import parse_duration
from ..domain.confirmation import (
    ConfirmationActionSet,
    ConfirmationContext,
    ConfirmationSelection,
)

DRAFT_SESSION_TTL = timedelta(minutes=15)


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


class ConfirmationActionsConfig(BaseModel):
    """Actions run after a confirmation is received."""

    enabled: bool = False
    items: list[dict[str, Any]] = Field(default_factory=list)


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
    actions: ConfirmationActionsConfig = Field(
        default_factory=ConfirmationActionsConfig
    )

    @classmethod
    def from_alert(cls, alert: dict[str, Any]) -> ConfirmationConfig | None:
        """Read confirmation configuration from an alert boundary."""

        value = alert.get("confirmation")
        if value is None:
            return None
        return cls.model_validate(value)


def pending_action_ids(runtime: dict[str, Any]) -> dict[str, str]:
    """Read canonical pending actions while migrating legacy runtime state."""

    action_ids = runtime.get("confirmation_action_ids") or {}
    if action_ids:
        return dict(action_ids)
    return {}


def clear_pending_actions(runtime: dict[str, Any]) -> None:
    """Clear all persisted pending confirmation action representations."""

    runtime["confirmation_action_ids"] = {}


class ConfirmationSession(BaseModel):
    """Mutable runtime state for one pending confirmation action."""

    model_config = ConfigDict(extra="forbid")

    alert_id: str | None = None
    draft_alert: dict[str, Any] | None = None
    selection: ConfirmationSelection
    created_at: datetime
    expires_at: datetime | None = None


class ConfirmationFeature(FeatureBase):
    """Own the Home Assistant confirmation-action subscription."""

    name = "confirmation"
    dependencies = ("alerts",)

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
        return parse_duration(settings.reminders.interval)

    @staticmethod
    def reminder_due(
        alert: dict[str, Any], runtime: dict[str, Any], now: datetime
    ) -> bool:
        """Decide whether a pending confirmation should be resent."""

        if not pending_action_ids(runtime):
            return False
        settings = ConfirmationConfig.from_alert(alert)
        if settings is None or not settings.enabled or not settings.reminders.enabled:
            return False
        if int(runtime.get("attempts", 0)) >= int(settings.reminders.max_attempts or 1):
            return False
        last_notified = runtime.get("last_notified")
        if not last_notified:
            return True
        try:
            previous = datetime.fromisoformat(str(last_notified))
        except ValueError:
            return True
        interval = parse_duration(settings.reminders.interval)
        return interval is None or now - previous >= interval

    async def _on_action_event(self, event: Any) -> None:
        result = await self.resolve_action_event(event)
        if result:
            await self.feature("alert_flow").handle_confirmation(result)

    async def track(
        self,
        session_id: str,
        *,
        now: datetime,
        alert_id: str | None = None,
        draft_alert: dict[str, Any] | None = None,
        ttl: timedelta | None = None,
        selection: ConfirmationSelection | None = None,
    ) -> None:
        """Track a pending confirmation owned by this feature."""

        self._sessions[session_id] = ConfirmationSession(
            alert_id=alert_id,
            draft_alert=draft_alert,
            selection=selection
            or ConfirmationSelection(session_id, "confirm", "Done"),
            created_at=now,
            expires_at=(now + ttl) if draft_alert is not None and ttl else None,
        )

    async def clear(self, session_id: str) -> None:
        """Stop tracking one pending confirmation."""

        self._sessions.pop(session_id, None)

    async def _clear_related(self, session: ConfirmationSession) -> None:
        """Stop tracking every response belonging to the same confirmation."""

        related_ids = [
            session_id
            for session_id, candidate in self._sessions.items()
            if (
                session.alert_id is not None
                and candidate.alert_id == session.alert_id
            )
            or (
                session.draft_alert is not None
                and candidate.draft_alert is not None
                and candidate.draft_alert.get("id")
                == session.draft_alert.get("id")
            )
        ]
        for session_id in related_ids:
            await self.clear(session_id)

    def has_pending(self, session_id: str) -> bool:
        """Return whether a confirmation session is still pending."""

        return session_id in self._sessions

    async def rebuild(self) -> None:
        """Restore pending saved-alert confirmations from runtime state."""

        self._sessions.clear()
        now = dt_util.utcnow()
        for alert_id, state in self._state[STATE_RUNTIME].items():
            action_ids = pending_action_ids(state)
            alert = self._alerts.get(alert_id)
            selections = self.selections_for(
                alert.model_dump(exclude_none=True) if alert else {},
                action_ids,
            )
            for selection in selections:
                await self.track(
                    selection.action_id,
                    now=now,
                    alert_id=alert_id,
                    selection=selection,
                )

    async def discard_draft(self, session_id: str, now: datetime) -> None:
        """Discard a draft and every confirmation action bound to it."""

        await self.expire_drafts(now)
        related_ids = [session_id]
        related_ids.extend(
            key
            for key, session in self._sessions.items()
            if session.draft_alert and session.draft_alert.get("id") == session_id
        )
        for key in set(related_ids):
            await self.clear(key)

    async def expire_drafts(self, now: datetime) -> list[str]:
        """Discard expired editor-draft confirmation sessions."""

        expired = [
            session_id
            for session_id, session in self._sessions.items()
            if session.expires_at and session.expires_at <= now
        ]
        for session_id in expired:
            self._sessions.pop(session_id, None)
        return expired

    async def resolve_action_event(self, event: Any) -> ConfirmationResult | None:
        """Resolve a Home Assistant action event to one typed confirmation fact."""

        event_data = event.data
        action_id = extract_action_id(event_data)
        if not action_id:
            return None

        now = dt_util.utcnow()
        await self.expire_drafts(now)
        session = self._sessions.get(action_id)
        if session is None:
            return None

        user_id = event.context.user_id if event.context else None
        confirmed_by = await resolve_confirmed_by(
            self._hass,
            self._hass.states.async_all("person"),
            user_id,
        )
        if session.draft_alert is not None:
            await self._clear_related(session)
            return ConfirmationResult(
                session.draft_alert,
                ConfirmationContext(confirmed_by, session.selection),
                now,
                True,
                False,
            )

        if session.alert_id is None:
            return None
        alert = self._alerts.get(session.alert_id)
        state = self._state[STATE_RUNTIME].get(session.alert_id)
        if (
            alert is None
            or state is None
            or action_id not in pending_action_ids(state)
        ):
            return None

        await self._clear_related(session)
        return ConfirmationResult(
            alert.model_dump(exclude_none=True),
            ConfirmationContext(confirmed_by, session.selection),
            now,
            False,
            True,
        )

    def selections_for(
        self, alert: dict[str, Any], action_ids: dict[str, str]
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
        self, alert: dict[str, Any], runtime: dict[str, Any]
    ) -> ConfirmationActionSet:
        """Return prepared notification actions for one pending alert."""

        action_ids = pending_action_ids(runtime)
        return ConfirmationActionSet(self.selections_for(alert, action_ids))

    def notification_actions(
        self, alert: dict[str, Any], action_ids: dict[str, str]
    ) -> list[dict[str, str]]:
        """Project draft or test response IDs into notification actions."""

        return ConfirmationActionSet(
            self.selections_for(alert, action_ids)
        ).notification_actions()

    @staticmethod
    def follow_up_actions(alert: dict[str, Any]) -> list[dict[str, Any]]:
        """Return configured post-confirmation actions without exposing config shape."""

        settings = ConfirmationConfig.from_alert(alert)
        if settings is None or not settings.actions.enabled:
            return []
        return settings.actions.items

    async def prepare_action(
        self,
        alert: dict[str, Any],
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
        existing = pending_action_ids(runtime)
        if existing:
            if now is not None:
                for selection in self.selections_for(alert, existing):
                    await self.track(
                        selection.action_id,
                        now=now,
                        alert_id=str(alert["id"]),
                        selection=selection,
                    )
            return
        action_ids = {
            f"NC_CONFIRM_{alert['id']}_{uuid4().hex}_{button.id}": button.id
            for button in confirmation.buttons
        }
        runtime["confirmation_action_ids"] = action_ids
        if now is not None:
            for selection in self.selections_for(alert, action_ids):
                await self.track(
                    selection.action_id,
                    now=now,
                    alert_id=str(alert["id"]),
                    selection=selection,
                )

    async def prepare_draft_actions(
        self,
        alert: dict[str, Any],
        draft_alert: dict[str, Any],
        *,
        now: datetime,
        prefix: str,
    ) -> dict[str, str]:
        """Create and track response actions for an unsaved test delivery."""

        settings = ConfirmationConfig.from_alert(alert)
        if settings is None or not settings.enabled:
            return {}
        action_ids = {
            f"{prefix}_{uuid4().hex}_{button.id}": button.id
            for button in settings.buttons
        }
        for selection in self.selections_for(alert, action_ids):
            await self.track(
                selection.action_id,
                now=now,
                draft_alert=draft_alert,
                ttl=DRAFT_SESSION_TTL,
                selection=selection,
            )
        return action_ids

# ----------------------------------------------------------------------


@dataclass(frozen=True)
class ConfirmationResult:
    """Resolved action with the alert data needed by the controller."""

    alert: dict[str, Any]
    confirmation: ConfirmationContext
    now: datetime
    test: bool
    record_history: bool


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
            return state.name

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




