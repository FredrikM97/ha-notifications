"""Notification Center runtime engine."""

from __future__ import annotations

import asyncio
import logging
import uuid
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any

from homeassistant.const import (
    EVENT_HOMEASSISTANT_STARTED,
)
from homeassistant.core import (
    Context,
    Event,
    HomeAssistant,
    callback,
)
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

from .const import (
    EVENT_NOTIFICATION_ACTION,
)
from .delivery import (
    NotificationDispatcher,
    _async_render_template,
    _remove_none,
    _render_value,
)
from .history import AlertHistory
from .models import (
    compile_condition,
    normalize_config,
    parse_duration,
)
from .storage import NotificationStorage

_LOGGER = logging.getLogger(__name__)

_DRAFT_SESSION_TTL = timedelta(minutes=15)

__all__ = (
    "NotificationCenter",
    "NotificationDispatcher",
    "_async_render_template",
    "_remove_none",
    "_render_value",
)


class NotificationCenter:
    """Notification Center runtime manager."""

    def __init__(
        self,
        hass: HomeAssistant,
    ) -> None:
        self.hass = hass

        self.storage = NotificationStorage(hass)

        self.dispatcher = NotificationDispatcher(hass)

        self.alerts: dict[
            str,
            dict[str, Any],
        ] = {}

        self.state: dict[str, Any] = {
            "alerts": {},
            "history": [],
        }

        self.history = AlertHistory(
            self.state,
            self.storage,
            self._ensure_runtime_state,
        )

        self._templates: dict[
            str,
            Template,
        ] = {}

        self._template_unsubs: dict[
            str,
            Any,
        ] = {}

        self._interval_unsubs: dict[
            str,
            Any,
        ] = {}

        self._tasks: set[asyncio.Task[Any]] = set()

        self._confirmation_unsub = None
        self._started_unsub = None

        self._started = False
        self._reload_lock = asyncio.Lock()

        self._pending_actions: dict[
            str,
            str,
        ] = {}
        self._draft_sessions: dict[str, datetime] = {}
        self._draft_actions: dict[str, dict[str, Any]] = {}

    # ---------------------------------------------------------
    # Setup / unload
    # ---------------------------------------------------------

    async def async_setup(self) -> None:
        """Set up the notification engine."""

        self.state = await self.storage.async_load_state()
        self.history.set_state(self.state)

        config = await self.storage.async_load_config()

        await self._apply_config(config)

        self._confirmation_unsub = self.hass.bus.async_listen(
            EVENT_NOTIFICATION_ACTION,
            self._handle_notification_action,
        )

        self._rebuild_pending_actions()

        if self.hass.is_running:
            self._started = True

            self._schedule(self._evaluate_all(source="startup"))

        else:
            self._started_unsub = self.hass.bus.async_listen_once(
                EVENT_HOMEASSISTANT_STARTED,
                self._handle_home_assistant_started,
            )

        _LOGGER.info(
            "Notification Center loaded %d alert(s)",
            len(self.alerts),
        )

    async def _handle_home_assistant_started(
        self,
        _event: Event,
    ) -> None:
        """Handle Home Assistant startup."""

        self._started = True

        await self._evaluate_all(source="startup")

    async def async_unload(self) -> bool:
        """Unload the engine."""

        if self._started_unsub:
            self._started_unsub()

            self._started_unsub = None

        if self._confirmation_unsub:
            self._confirmation_unsub()

            self._confirmation_unsub = None

        self._remove_alert_listeners()

        for task in list(self._tasks):
            if not task.done():
                task.cancel()

        if self._tasks:
            await asyncio.gather(
                *self._tasks,
                return_exceptions=True,
            )

        self._tasks.clear()

        await self.storage.async_save_state_now(self.state)

        return True

    # ---------------------------------------------------------
    # Configuration
    # ---------------------------------------------------------

    async def _apply_config(
        self,
        config: dict[str, Any],
    ) -> None:
        """Apply configuration."""

        normalized = normalize_config(config)

        self._remove_alert_listeners()

        self.alerts = {alert["id"]: alert for alert in normalized["alerts"]}

        for alert_id in list(self.state["alerts"]):
            if alert_id not in self.alerts:
                del self.state["alerts"][alert_id]

        for alert in self.alerts.values():
            self._ensure_runtime_state(alert)

            if alert.get(
                "enabled",
                True,
            ):
                self._setup_alert(alert)

    def _remove_alert_listeners(self) -> None:
        """Remove alert listeners."""

        for unsub in self._template_unsubs.values():
            try:
                unsub.async_remove()
            except Exception:
                _LOGGER.exception("Failed removing template listener")

        self._template_unsubs.clear()

        for unsub in self._interval_unsubs.values():
            try:
                unsub()
            except Exception:
                _LOGGER.exception("Failed removing interval listener")

        self._interval_unsubs.clear()

        self._templates.clear()

    async def async_reload(self) -> None:
        """Reload configuration from disk."""

        async with self._reload_lock:
            config = await self.storage.async_load_config()

            await self._apply_config(config)

            self._rebuild_pending_actions()

            if self._started:
                await self._evaluate_all(source="startup")

    # ---------------------------------------------------------
    # Alert setup
    # ---------------------------------------------------------

    def _setup_alert(
        self,
        alert: dict[str, Any],
    ) -> None:
        """Set up listeners for one alert."""

        alert_id = alert["id"]

        template = Template(
            compile_condition(alert),
            self.hass,
        )

        self._templates[alert_id] = template

        monitor = alert["monitor"]

        if monitor.get(
            "on_change",
            True,
        ):

            @callback
            def template_callback(
                event: Event | None,
                updates: list[TrackTemplateResult],
            ) -> None:
                """Handle template changes."""

                for update in updates:
                    if update.template is not template:
                        continue

                    if isinstance(
                        update.result,
                        TemplateError,
                    ):
                        self._schedule(
                            self.history.record(
                                alert,
                                "condition_error",
                                "Template evaluation failed.",
                                {"error": str(update.result)},
                            )
                        )
                        continue

                    active = result_as_boolean(update.result)

                    context = event.context if event else None

                    self._schedule(
                        self._process_condition(
                            alert,
                            active,
                            source="change",
                            context=context,
                        )
                    )

            self._template_unsubs[alert_id] = async_track_template_result(
                self.hass,
                [
                    TrackTemplate(
                        template,
                        None,
                    )
                ],
                template_callback,
            )

        confirmation = alert["notification"].get(
            "confirmation",
            {},
        )

        interval = monitor.get("interval")

        if not interval and confirmation.get(
            "enabled",
            False,
        ):
            interval = confirmation.get("resend_interval")

        if interval:
            interval_delta = parse_duration(interval)

            @callback
            def periodic_callback(
                _now: datetime,
            ) -> None:
                """Run periodic evaluation."""

                self._schedule(
                    self._evaluate_alert(
                        alert,
                        source="interval",
                    )
                )

            self._interval_unsubs[alert_id] = async_track_time_interval(
                self.hass,
                periodic_callback,
                interval_delta,
            )

    # ---------------------------------------------------------
    # Evaluation
    # ---------------------------------------------------------

    async def _evaluate_all(
        self,
        *,
        source: str,
    ) -> None:
        """Evaluate all alerts."""

        for alert in list(self.alerts.values()):
            if not alert.get(
                "enabled",
                True,
            ):
                continue

            await self._evaluate_alert(
                alert,
                source=source,
            )

    async def _evaluate_alert(
        self,
        alert: dict[str, Any],
        *,
        source: str,
    ) -> None:
        """Evaluate one alert."""

        if not self._started:
            return

        template = self._templates.get(alert["id"])

        if template is None:
            return

        try:
            result = await _async_render_template(
                template,
                parse_result=True,
                strict=False,
            )

            active = result_as_boolean(result)

        except TemplateError as err:
            await self.history.record(
                alert,
                "condition_error",
                "Template evaluation failed.",
                {
                    "error": str(err),
                    "source": source,
                },
            )
            return

        await self._process_condition(
            alert,
            active,
            source=source,
            context=None,
        )

    # ---------------------------------------------------------
    # Condition state machine
    # ---------------------------------------------------------

    def _ensure_runtime_state(
        self,
        alert: dict[str, Any],
    ) -> dict[str, Any]:
        """Return runtime state for an alert."""

        state = self.state["alerts"].setdefault(
            alert["id"],
            {
                "active": False,
                "acknowledged": False,
                "attempts": 0,
                "notification_id": None,
                "confirmation_action_id": None,
                "started_at": None,
                "last_evaluated": None,
                "last_notified": None,
                "confirmed_at": None,
                "confirmed_by": None,
                "last_error": None,
                "last_event": None,
            },
        )

        return state

    async def _process_condition(
        self,
        alert: dict[str, Any],
        active: bool,
        *,
        source: str,
        context: Context | None,
    ) -> None:
        """Process a condition result."""

        state = self._ensure_runtime_state(alert)

        now = dt_util.utcnow()

        state["last_evaluated"] = now.isoformat()

        if not active:
            if state.get(
                "active",
                False,
            ):
                had_pending_confirmation = bool(state.get("confirmation_action_id"))

                state["active"] = False
                state["acknowledged"] = False
                state["attempts"] = 0
                state["confirmation_action_id"] = None
                state["notification_id"] = None

                if had_pending_confirmation:
                    try:
                        await self.dispatcher.async_clear(
                            alert,
                            context=context,
                        )
                    except Exception:
                        _LOGGER.exception(
                            "Failed clearing notification for %s",
                            alert["id"],
                        )

                await self.history.record(
                    alert,
                    "condition_inactive",
                    "Condition became false.",
                    {
                        "source": source,
                    },
                )

                self._save_state()

            return

        # New active episode.
        if not state.get(
            "active",
            False,
        ):
            state["active"] = True
            state["acknowledged"] = False
            state["attempts"] = 0
            state["started_at"] = now.isoformat()

            state["notification_id"] = (
                f"notification_center_{alert['id']}_{uuid.uuid4().hex[:10]}"
            )

            confirmation = alert["notification"].get(
                "confirmation",
                {},
            )

            if confirmation.get(
                "enabled",
                False,
            ):
                action_id = f"NC_CONFIRM_{alert['id']}_{uuid.uuid4().hex}"

                state["confirmation_action_id"] = action_id

                self._pending_actions[action_id] = alert["id"]

            await self.history.record(
                alert,
                "condition_active",
                "Condition became true.",
                {
                    "source": source,
                },
            )

            await self._send_notification(
                alert,
                context=context,
            )

            return

        # Already acknowledged.
        if state.get(
            "acknowledged",
            False,
        ):
            return

        # Startup/interval can cause a repeat.
        if source in (
            "startup",
            "interval",
        ):
            if self._notification_due(
                alert,
                state,
            ):
                await self._send_notification(
                    alert,
                    context=context,
                )

    def _notification_due(
        self,
        alert: dict[str, Any],
        state: dict[str, Any],
    ) -> bool:
        """Determine if a repeated notification is due."""

        notification = alert["notification"]
        repeat = notification.get("repeat")

        confirmation = notification.get(
            "confirmation",
            {},
        )

        confirmation_pending = bool(state.get("confirmation_action_id"))

        if confirmation_pending and confirmation.get(
            "enabled",
            False,
        ):
            repeat = {
                "interval": confirmation.get("resend_interval"),
                "max_attempts": confirmation.get(
                    "max_attempts",
                    5,
                ),
            }

        if not repeat or not repeat.get("enabled", True):
            return False

        attempts = int(
            state.get(
                "attempts",
                0,
            )
        )

        max_attempts = int(
            repeat.get(
                "max_attempts",
                1,
            )
        )

        if attempts >= max_attempts:
            return False

        last_notified = state.get("last_notified")

        if not last_notified:
            return True

        parsed = dt_util.parse_datetime(str(last_notified))

        if parsed is None:
            return True

        elapsed = dt_util.utcnow() - parsed

        interval = parse_duration(repeat["interval"])

        return elapsed >= interval

    async def _send_notification(
        self,
        alert: dict[str, Any],
        *,
        context: Context | None,
    ) -> None:
        """Send a notification and update runtime state."""

        state = self._ensure_runtime_state(alert)

        attempt = (
            int(
                state.get(
                    "attempts",
                    0,
                )
            )
            + 1
        )

        action_id = state.get("confirmation_action_id")

        try:
            await self.dispatcher.async_send(
                alert,
                attempt=attempt,
                confirmation_action_id=action_id,
                context=context,
            )

        except Exception as err:
            state["last_error"] = str(err)

            await self.history.record(
                alert,
                "notification_failed",
                "Notification failed.",
                {
                    "attempt": attempt,
                    "error": str(err),
                },
            )

            _LOGGER.exception(
                "Notification failed for alert %s",
                alert["id"],
            )

            self._save_state()
            return

        now = dt_util.utcnow()

        state["attempts"] = attempt

        state["last_notified"] = now.isoformat()

        state["last_error"] = None

        await self.history.record(
            alert,
            "notification_sent",
            "Notification sent.",
            {
                "attempt": attempt,
            },
        )

        await self._run_notification_actions(
            alert,
            context,
            attempt,
        )

        self._save_state()

    # ---------------------------------------------------------
    # Confirmation handling
    # ---------------------------------------------------------

    def _rebuild_pending_actions(
        self,
    ) -> None:
        """Rebuild confirmation action index."""

        self._pending_actions.clear()

        for alert_id, state in self.state["alerts"].items():
            action_id = state.get("confirmation_action_id")

            if action_id:
                self._pending_actions[action_id] = alert_id

    async def _handle_notification_action(
        self,
        event: Event,
    ) -> None:
        """Handle a mobile app confirmation."""

        action = (
            event.data.get("action")
            if isinstance(
                event.data,
                dict,
            )
            else None
        )

        if not action:
            return

        self._expire_draft_sessions()

        draft = getattr(self, "_draft_actions", {}).get(action)
        if draft is not None:
            self._discard_draft_session(draft["session_id"])
            await self._handle_draft_confirmation(draft["alert"], event)
            return

        alert_id = self._pending_actions.get(action)

        if not alert_id:
            return

        alert = self.alerts.get(alert_id)

        if alert is None:
            return

        state = self._ensure_runtime_state(alert)

        if state.get("confirmation_action_id") != action:
            return

        confirmed_by = self._resolve_user(
            event.context.user_id if event.context else None
        )

        state["acknowledged"] = True

        state["confirmation_action_id"] = None

        state["confirmed_at"] = dt_util.utcnow().isoformat()

        state["confirmed_by"] = confirmed_by

        self._pending_actions.pop(
            action,
            None,
        )

        await self.history.record(
            alert,
            "confirmed",
            "Notification confirmed.",
            {
                "confirmed_by": confirmed_by,
            },
        )

        notification = alert["notification"]

        confirmation = notification.get(
            "confirmation",
            {},
        )

        if confirmation.get("clear_on_confirmation", True):
            try:
                await self.dispatcher.async_clear(
                    alert,
                    context=event.context,
                )
            except Exception:
                _LOGGER.exception(
                    "Failed to clear notification for %s",
                    alert_id,
                )

        completion_message = confirmation.get("completion_message") or ""

        confirmation_message = confirmation.get("confirmation_message")

        if confirmation.get("notify_on_confirmation", False):
            completion_message = (
                confirmation_message
                or completion_message
                or "{{ confirmed_by }} confirmed this notification."
            )

        if completion_message:
            completion_alert = deepcopy(alert)

            completion_alert["notification"] = deepcopy(notification)

            completion_alert["notification"]["message"] = await _render_value(
                self.hass,
                completion_message,
                {
                    "alert_id": alert["id"],
                    "alert_name": alert["name"],
                    "alert_active": True,
                    "confirmed_by": confirmed_by,
                    "context": event.context,
                    "now": dt_util.now(),
                },
            )

            completion_alert["notification"]["confirmation"] = {
                "enabled": False,
                "button": "",
                "completion_message": "",
                "actions": [],
            }

            try:
                await self.dispatcher.async_send(
                    completion_alert,
                    attempt=1,
                    confirmation_action_id=None,
                    context=event.context,
                )

                await self.history.record(
                    alert,
                    "completion_sent",
                    "Completion notification sent.",
                    {},
                )

            except Exception as err:
                await self.history.record(
                    alert,
                    "completion_failed",
                    "Completion notification failed.",
                    {
                        "error": str(err),
                    },
                )

        await self._run_confirmation_actions(
            alert,
            event.context,
            confirmed_by,
        )

        self._save_state()

    async def _handle_draft_confirmation(
        self,
        alert: dict[str, Any],
        event: Event,
    ) -> None:
        """Handle a draft confirmation without touching runtime state."""

        confirmed_by = self._resolve_user(
            event.context.user_id if event.context else None
        )
        notification = alert["notification"]
        confirmation = notification.get("confirmation", {})

        if confirmation.get("clear_on_confirmation", True):
            try:
                await self.dispatcher.async_clear(alert, context=event.context)
            except Exception:
                _LOGGER.exception("Failed to clear draft notification")

        completion_message = confirmation.get("completion_message") or ""
        if confirmation.get("notify_on_confirmation", False):
            completion_message = (
                confirmation.get("confirmation_message")
                or completion_message
                or "{{ confirmed_by }} confirmed this notification."
            )

        if completion_message:
            completion_alert = deepcopy(alert)
            completion_alert["notification"] = deepcopy(notification)
            completion_alert["notification"]["message"] = await _render_value(
                self.hass,
                completion_message,
                {
                    "alert_id": alert["id"],
                    "alert_name": alert["name"],
                    "alert_active": True,
                    "confirmed_by": confirmed_by,
                    "context": event.context,
                    "now": dt_util.now(),
                },
            )
            completion_alert["notification"]["confirmation"] = {"enabled": False}

            try:
                await self.dispatcher.async_send(
                    completion_alert,
                    attempt=1,
                    confirmation_action_id=None,
                    context=event.context,
                    test=True,
                )
            except Exception:
                _LOGGER.exception("Failed to send draft completion notification")

        await self._run_draft_confirmation_actions(
            alert,
            event.context,
            confirmed_by,
        )

    async def _run_draft_confirmation_actions(
        self,
        alert: dict[str, Any],
        context: Context | None,
        confirmed_by: str,
    ) -> None:
        """Run draft follow-up actions without writing alert history."""

        confirmation = alert["notification"].get("confirmation", {})
        if not confirmation.get("actions_enabled", False):
            return

        variables = {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "confirmed_by": confirmed_by,
            "now": dt_util.now(),
        }
        for action in confirmation.get("actions", []):
            try:
                service = str(
                    await _render_value(self.hass, action.get("action"), variables)
                    or ""
                )
                if not service or "." not in service:
                    raise ValueError("Invalid confirmation action.")
                target = await _render_value(
                    self.hass, action.get("target", {}), variables
                )
                data = _remove_none(
                    await _render_value(self.hass, action.get("data", {}), variables)
                )
                domain, service_name = service.split(".", 1)
                await self.hass.services.async_call(
                    domain,
                    service_name,
                    service_data=data if isinstance(data, dict) else {},
                    target=target if target else None,
                    blocking=True,
                    context=context,
                )
            except Exception:
                _LOGGER.exception(
                    "Draft confirmation action failed for %s",
                    alert["id"],
                )

    async def _run_notification_actions(
        self,
        alert: dict[str, Any],
        context: Context | None,
        attempt: int,
    ) -> None:
        """Run actions after a notification dispatch."""

        notification = alert["notification"]
        if not notification.get("actions_enabled", False):
            return

        variables = {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "attempt": attempt,
            "context": context,
            "now": dt_util.now(),
        }

        for index, action in enumerate(notification.get("actions", []), start=1):
            try:
                service = str(
                    await _render_value(self.hass, action.get("action"), variables)
                    or ""
                )
                if not service or "." not in service:
                    raise ValueError("Invalid post-send action.")

                target = await _render_value(
                    self.hass, action.get("target", {}), variables
                )
                data = _remove_none(
                    await _render_value(self.hass, action.get("data", {}), variables)
                )
                domain, service_name = service.split(".", 1)
                await self.hass.services.async_call(
                    domain,
                    service_name,
                    service_data=data if isinstance(data, dict) else {},
                    target=target if target else None,
                    blocking=True,
                    context=context,
                )
                await self.history.record(
                    alert,
                    "notification_action",
                    "Post-send action executed.",
                    {"attempt": attempt, "index": index, "action": service},
                )
            except Exception as err:
                _LOGGER.exception("Post-send action failed for %s", alert["id"])
                await self.history.record(
                    alert,
                    "notification_action_failed",
                    "Post-send action failed.",
                    {"attempt": attempt, "index": index, "error": str(err)},
                )

    def _resolve_user(
        self,
        user_id: str | None,
    ) -> str:
        """Resolve a Home Assistant user to a person."""

        if not user_id:
            return "Unknown user"

        for state in self.hass.states.async_all("person"):
            if state.attributes.get("user_id") == user_id:
                return state.name

        return "Unknown user"

    async def _run_confirmation_actions(
        self,
        alert: dict[str, Any],
        context: Context | None,
        confirmed_by: str,
    ) -> None:
        """Run actions after confirmation."""

        confirmation = alert["notification"].get(
            "confirmation",
            {},
        )

        if not confirmation.get("actions_enabled", False):
            return

        actions = confirmation.get(
            "actions",
            [],
        )

        variables = {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "confirmed_by": confirmed_by,
            "now": dt_util.now(),
        }

        for index, action in enumerate(
            actions,
            start=1,
        ):
            try:
                service = await _render_value(
                    self.hass,
                    action.get("action"),
                    variables,
                )
                service = str(service or "")

                if not service or "." not in service:
                    raise ValueError("Invalid confirmation action.")

                target = await _render_value(
                    self.hass,
                    action.get(
                        "target",
                        {},
                    ),
                    variables,
                )

                data = await _render_value(
                    self.hass,
                    action.get(
                        "data",
                        {},
                    ),
                    variables,
                )
                data = _remove_none(data)

                domain, service_name = service.split(
                    ".",
                    1,
                )

                await self.hass.services.async_call(
                    domain,
                    service_name,
                    service_data=(
                        data
                        if isinstance(
                            data,
                            dict,
                        )
                        else {}
                    ),
                    target=(target if target else None),
                    blocking=True,
                    context=context,
                )

                await self.history.record(
                    alert,
                    "confirmation_action",
                    "Confirmation action executed.",
                    {
                        "index": index,
                        "action": service,
                    },
                )

            except Exception as err:
                _LOGGER.exception(
                    "Confirmation action failed for %s",
                    alert["id"],
                )

                await self.history.record(
                    alert,
                    "confirmation_action_failed",
                    "Confirmation action failed.",
                    {
                        "index": index,
                        "error": str(err),
                    },
                )

    # ---------------------------------------------------------
    # Public operations
    # ---------------------------------------------------------

    async def async_test_alert(
        self,
        alert_id: str,
    ) -> None:
        """Send a test notification."""

        alert = self.alerts.get(alert_id)

        if alert is None:
            raise ValueError(f"Unknown alert: {alert_id}")

        confirmation = alert["notification"].get(
            "confirmation",
            {},
        )

        confirmation_action_id = None

        if confirmation.get(
            "enabled",
            False,
        ):
            confirmation_action_id = f"NC_TEST_CONFIRM_{alert_id}_{uuid.uuid4().hex}"

            state = self._ensure_runtime_state(alert)
            state["confirmation_action_id"] = confirmation_action_id
            self._pending_actions[confirmation_action_id] = alert_id

        await self.dispatcher.async_send(
            alert,
            attempt=1,
            confirmation_action_id=confirmation_action_id,
            context=None,
            test=True,
        )

        await self.history.record(
            alert,
            "test",
            "Test notification sent.",
            {},
        )

    async def async_test_alert_payload(
        self,
        alert: dict[str, Any],
    ) -> dict[str, str | None]:
        """Send a normalized editor draft without saving or changing runtime state."""

        if not hasattr(self, "_draft_sessions"):
            self._draft_sessions = {}
            self._draft_actions = {}

        normalized = normalize_config(
            {
                "version": 1,
                "alerts": [alert],
            }
        )["alerts"][0]

        self._expire_draft_sessions()
        session_id = f"NC_DRAFT_{uuid.uuid4().hex}"
        delivery_alert = deepcopy(normalized)
        delivery_alert["id"] = session_id
        expires_at = dt_util.utcnow() + _DRAFT_SESSION_TTL
        self._draft_sessions[session_id] = expires_at
        if hasattr(self, "hass") and hasattr(self, "_tasks"):
            self._schedule(self._async_expire_draft_session(session_id, expires_at))

        confirmation = delivery_alert["notification"].get("confirmation", {})
        confirmation_action_id = None
        if confirmation.get("enabled", False):
            confirmation_action_id = f"NC_DRAFT_CONFIRM_{uuid.uuid4().hex}"
            self._draft_actions[confirmation_action_id] = {
                "session_id": session_id,
                "alert": delivery_alert,
            }

        await self.dispatcher.async_send(
            delivery_alert,
            attempt=1,
            confirmation_action_id=confirmation_action_id,
            context=None,
            test=True,
        )

        return {
            "session_id": session_id,
            "confirmation_action_id": confirmation_action_id,
        }

    def _expire_draft_sessions(self) -> None:
        """Discard draft sessions whose confirmation window has expired."""

        now = dt_util.utcnow()
        for session_id, expires_at in list(
            getattr(self, "_draft_sessions", {}).items()
        ):
            if expires_at <= now:
                self._discard_draft_session(session_id)

    async def _async_expire_draft_session(
        self,
        session_id: str,
        expires_at: datetime,
    ) -> None:
        """Release an idle draft session once its confirmation TTL ends."""

        seconds = max(0, (expires_at - dt_util.utcnow()).total_seconds())
        await asyncio.sleep(seconds)
        self._expire_draft_sessions()

    def _discard_draft_session(self, session_id: str) -> None:
        """Remove all temporary confirmation actions for one draft session."""

        getattr(self, "_draft_sessions", {}).pop(session_id, None)
        for action_id, draft in list(getattr(self, "_draft_actions", {}).items()):
            if draft["session_id"] == session_id:
                self._draft_actions.pop(action_id, None)

    async def async_discard_draft_test(self, session_id: str) -> None:
        """Explicitly dispose an editor draft test session."""

        self._expire_draft_sessions()
        self._discard_draft_session(session_id)

    async def async_save_alert(
        self,
        alert: dict[str, Any],
    ) -> dict[str, Any]:
        """Create or update an alert."""

        config = await self.storage.async_load_config()

        alerts = list(config["alerts"])

        normalized = normalize_config(
            {
                "version": 1,
                "alerts": [alert],
            }
        )["alerts"][0]

        existing = next(
            (item for item in alerts if item["id"] == normalized["id"]),
            None,
        )

        now = dt_util.utcnow().isoformat()

        if existing:
            normalized["created_at"] = existing.get("created_at") or now
        else:
            normalized["created_at"] = now

        normalized["updated_at"] = now

        if existing:
            alerts = [
                (normalized if item["id"] == normalized["id"] else item)
                for item in alerts
            ]
        else:
            alerts.append(normalized)

        await self.storage.async_save_config(
            {
                "version": 1,
                "alerts": alerts,
            }
        )

        await self.async_reload()

        return normalized

    async def async_delete_alert(
        self,
        alert_id: str,
    ) -> None:
        """Delete an alert."""

        alert = self.alerts.get(alert_id)

        if alert:
            try:
                await self.dispatcher.async_clear(
                    alert,
                    context=None,
                )
            except Exception:
                _LOGGER.exception(
                    "Failed clearing notification before deleting %s",
                    alert_id,
                )

        config = await self.storage.async_load_config()

        config["alerts"] = [
            alert for alert in config["alerts"] if alert["id"] != alert_id
        ]

        await self.storage.async_save_config(config)

        self.state["alerts"].pop(
            alert_id,
            None,
        )

        self.history.remove_alert(alert_id)

        await self.async_reload()

        self.storage.async_delay_save_state(self.state)

    async def async_validate_yaml(
        self,
        text: str,
    ) -> dict[str, Any]:
        """Validate raw YAML without changing the saved config."""

        return await self.storage.async_validate_yaml_text(text)

    async def async_save_yaml(
        self,
        text: str,
    ) -> dict[str, Any]:
        """Replace configuration using raw YAML."""

        normalized = await self.storage.async_save_yaml_text(text)

        await self.async_reload()
        return normalized

    async def async_get_yaml(
        self,
    ) -> str:
        """Return YAML."""

        return await self.storage.async_load_yaml_text()

    async def async_list_alerts(
        self,
    ) -> list[dict[str, Any]]:
        """Return alerts with runtime information."""

        result = []

        for alert in self.alerts.values():
            state = self._ensure_runtime_state(alert)

            result.append(
                {
                    **deepcopy(alert),
                    "runtime": deepcopy(state),
                }
            )

        return result

    async def async_history(
        self,
        alert_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Return trace history."""

        return await self.history.list(alert_id, limit)

    def _save_state(self) -> None:
        """Schedule persistent state save."""

        self.storage.async_delay_save_state(self.state)

    def _schedule(
        self,
        coroutine: Any,
    ) -> None:
        """Schedule an async task and track it."""

        task = self.hass.async_create_task(coroutine)

        self._tasks.add(task)

        task.add_done_callback(self._tasks.discard)
