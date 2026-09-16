"""Track confirmation sessions and route response events."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from ..const import EVENT_NOTIFICATION_ACTION, STATE_RUNTIME
from ..controller.lifecycle import FeatureBase, route
from .feature_config import AlertFeatureConfig

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


class ConfirmationConfig(AlertFeatureConfig):
    """Validated confirmation prompt and its owned follow-up settings."""

    model_config = ConfigDict(extra="allow")

    enabled: bool | None = None
    button: str | None = None
    notification: ConfirmationNotificationConfig = Field(
        default_factory=ConfirmationNotificationConfig
    )
    reminders: ConfirmationReminderConfig = Field(
        default_factory=ConfirmationReminderConfig
    )
    actions: ConfirmationActionsConfig = Field(
        default_factory=ConfirmationActionsConfig
    )


def confirmation_config(value: Any) -> ConfirmationConfig:
    """Validate one confirmation payload at the confirmation feature boundary."""

    return ConfirmationConfig.model_validate(value)


def confirmation_for_alert(alert: dict[str, Any]) -> ConfirmationConfig | None:
    """Read the alert-level confirmation configuration."""

    value = alert.get("confirmation")
    if value is None:
        return None
    return ConfirmationConfig.model_validate(value)


class ConfirmationSession(BaseModel):
    """Mutable runtime state for one pending confirmation action."""

    model_config = ConfigDict(extra="forbid")

    alert_id: str | None = None
    draft_alert: dict[str, Any] | None = None
    created_at: datetime
    expires_at: datetime | None = None


class ConfirmationFeature(FeatureBase):
    """Own the Home Assistant confirmation-action subscription."""

    name = "confirmation"
    dependencies = ("alerts",)

    def __init__(self, services: Any) -> None:
        super().__init__(services)
        self._sessions = services.sessions
        self._alerts: dict[str, Any] = {}
        self._unsubscribe: Callable[[], None] | None = None

    async def on_setup(self) -> None:
        self._alerts = self.feature("alerts").alerts
        self._unsubscribe = self.services.gateway.bus_listen(
            EVENT_NOTIFICATION_ACTION, self._on_action_event
        )

    async def on_unload(self) -> None:
        if self._unsubscribe:
            self._unsubscribe()
            self._unsubscribe = None

    async def _on_action_event(self, event: Any) -> None:
        if self.lifecycle is None:
            return
        result = await self.lifecycle.dispatch("confirmation.resolve", event)
        if result:
            await self.lifecycle.dispatch("flows.confirmation", result)

    @route("confirmation.track")
    async def track(
        self,
        session_id: str,
        *,
        now: datetime,
        alert_id: str | None = None,
        draft_alert: dict[str, Any] | None = None,
        ttl: timedelta | None = None,
    ) -> None:
        """Track a pending confirmation owned by this feature."""

        self._sessions[session_id] = ConfirmationSession(
            alert_id=alert_id,
            draft_alert=draft_alert,
            created_at=now,
            expires_at=(now + ttl) if draft_alert is not None and ttl else None,
        )

    @route("confirmation.clear")
    async def clear(self, session_id: str) -> None:
        """Stop tracking one pending confirmation."""

        self._sessions.pop(session_id, None)

    @route("confirmation.expire_drafts")
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

    @route("confirmation.resolve")
    async def resolve_action_event(self, event: Any) -> ConfirmationResult | None:
        """Resolve a Home Assistant action event to one typed confirmation fact."""

        event_data = event.data
        action_id = extract_action_id(event_data)
        if not action_id:
            return None

        now = self.services.gateway.now_utc()
        await self.expire_drafts(now)
        session = self._sessions.get(action_id)
        if session is None:
            return None

        user_id = event.context.user_id if event.context else None
        confirmed_by = await resolve_confirmed_by(
            self.services.hass,
            self.services.hass.states.async_all("person"),
            user_id,
        )
        if session.draft_alert is not None:
            await self.clear(action_id)
            return ConfirmationResult(
                session.draft_alert, confirmed_by, now, True, False
            )

        if session.alert_id is None:
            return None
        alert = self._alerts.get(session.alert_id)
        state = self.services.state[STATE_RUNTIME].get(session.alert_id)
        if (
            alert is None
            or state is None
            or state.get("confirmation_action_id") != action_id
        ):
            return None

        await self.clear(action_id)
        return ConfirmationResult(
            alert.model_dump(exclude_none=True), confirmed_by, now, False, True
        )

    @route("confirmation.prepare")
    async def prepare_action(
        self, alert: dict[str, Any], runtime: dict[str, Any]
    ) -> tuple[bool, str | None]:
        """Create a pending action only when confirmation is configured."""

        confirmation = ConfirmationConfig.model_validate(
            alert.get("confirmation") or {}
        )
        if not confirmation.enabled:
            return False, None
        action_id = runtime.get("confirmation_action_id")
        if action_id:
            return False, str(action_id)
        action_id = f"NC_CONFIRM_{alert['id']}_{uuid4().hex}"
        runtime["confirmation_action_id"] = action_id
        return True, action_id

# ----------------------------------------------------------------------
# Incoming mobile-action event routing (was ConfirmationActionHandler)
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class ConfirmationResult:
    """Resolved action with the alert data needed by the controller."""

    alert: dict[str, Any]
    confirmed_by: str
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




