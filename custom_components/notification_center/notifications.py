"""HA Notifications runtime engine."""

from __future__ import annotations

import asyncio
import logging
import uuid
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
from .runtime import (
    ConfirmationSupport,
    DraftConfirmationSessions,
    NotificationActionRunner,
    NotificationConfigAPI,
    ensure_alert_state,
    notification_due,
    resolve_user,
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
    """HA Notifications runtime manager."""

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

        self.action_runner = NotificationActionRunner(
            hass,
            self.history,
        )

        self.confirmation_support = ConfirmationSupport(
            hass,
            self.dispatcher,
            self.history,
        )

        self.config_api = NotificationConfigAPI(self)

        self.draft_sessions = DraftConfirmationSessions(_DRAFT_SESSION_TTL)

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
        self._draft_sessions = self.draft_sessions.sessions
        self._draft_actions = self.draft_sessions.actions

    @property
    def _action_runner(self) -> NotificationActionRunner:
        """Return the service action runner, creating it for test instances."""

        runner = getattr(self, "action_runner", None)
        if runner is None:
            runner = NotificationActionRunner(
                self.hass,
                self.history,
            )
            self.action_runner = runner
        return runner

    @property
    def _draft_store(self) -> DraftConfirmationSessions:
        """Return draft sessions, creating them for test instances."""

        sessions = getattr(self, "draft_sessions", None)
        if sessions is None:
            sessions = DraftConfirmationSessions(_DRAFT_SESSION_TTL)
            self.draft_sessions = sessions
            self._draft_sessions = sessions.sessions
            self._draft_actions = sessions.actions
        return sessions

    @property
    def _confirmation_support(self) -> ConfirmationSupport:
        """Return confirmation helpers, creating them for test instances."""

        support = getattr(self, "confirmation_support", None)
        if support is None:
            support = ConfirmationSupport(
                self.hass,
                self.dispatcher,
                self.history,
            )
            self.confirmation_support = support
        return support

    @property
    def _config_api(self) -> NotificationConfigAPI:
        """Return config operations, creating them for test instances."""

        api = getattr(self, "config_api", None)
        if api is None:
            api = NotificationConfigAPI(self)
            self.config_api = api
        return api

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
            "HA Notifications loaded %d alert(s)",
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
    ) -> set[str]:
        """Apply configuration."""

        normalized = normalize_config(config)
        previous_alerts = self.alerts

        self._remove_alert_listeners()

        self.alerts = {alert["id"]: alert for alert in normalized["alerts"]}
        newly_enabled_alert_ids = set()

        for alert_id in list(self.state["alerts"]):
            if alert_id not in self.alerts:
                del self.state["alerts"][alert_id]

        for alert in self.alerts.values():
            self._ensure_runtime_state(alert)

            if alert.get(
                "enabled",
                True,
            ):
                previous = previous_alerts.get(alert["id"])
                if previous is not None and not previous.get("enabled", True):
                    newly_enabled_alert_ids.add(alert["id"])

                self._setup_alert(alert)

        return newly_enabled_alert_ids

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

            newly_enabled_alert_ids = await self._apply_config(config)

            self._rebuild_pending_actions()

            if self._started:
                for alert_id in newly_enabled_alert_ids:
                    alert = self.alerts.get(alert_id)
                    if alert is not None:
                        await self._evaluate_alert(
                            alert,
                            source="enabled",
                        )

                await self._evaluate_all(source="reload")

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
        repeat = alert["notification"].get("repeat")

        interval = monitor.get("interval")

        if (
            not interval
            and isinstance(repeat, dict)
            and repeat.get("enabled", True)
        ):
            interval = repeat.get("interval")

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
            if source == "startup" and not alert.get("monitor", {}).get(
                "startup",
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

        return ensure_alert_state(self.state, alert)

    def _ensure_confirmation_action(
        self,
        alert: dict[str, Any],
        state: dict[str, Any],
    ) -> None:
        """Ensure an active confirmation alert has a pending action ID."""

        confirmation = alert["notification"].get(
            "confirmation",
            {},
        )

        if not confirmation.get("enabled", False):
            return

        if state.get("confirmation_action_id"):
            return

        action_id = f"NC_CONFIRM_{alert['id']}_{uuid.uuid4().hex}"
        state["confirmation_action_id"] = action_id
        self._pending_actions[action_id] = alert["id"]

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

            self._ensure_confirmation_action(alert, state)

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

        attempts = int(state.get("attempts", 0))
        has_sent = bool(state.get("last_notified") or attempts)

        if (
            source == "startup"
            and alert.get("monitor", {}).get("startup", True)
            and not has_sent
        ):
            self._ensure_confirmation_action(alert, state)
            await self._send_notification(
                alert,
                context=context,
            )
            return

        if source == "enabled" and not has_sent:
            self._ensure_confirmation_action(alert, state)
            await self._send_notification(
                alert,
                context=context,
            )
            return

        # Startup/interval can cause a repeat.
        if source in (
            "reload",
            "startup",
            "interval",
        ):
            if notification_due(alert["notification"], state):
                self._ensure_confirmation_action(alert, state)
                await self._send_notification(
                    alert,
                    context=context,
                    replace_existing=True,
                )

    async def _send_notification(
        self,
        alert: dict[str, Any],
        *,
        context: Context | None,
        replace_existing: bool = False,
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
            if replace_existing:
                try:
                    await self.dispatcher.async_clear(
                        alert,
                        context=context,
                    )
                except Exception:
                    _LOGGER.exception(
                        "Failed clearing previous notification for %s",
                        alert["id"],
                    )

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

        if alert["notification"].get("actions_enabled", False):
            await self._action_runner.async_run_notification_actions(
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

        draft = self._draft_store.resolve_action(action)
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

        confirmation = alert["notification"].get(
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

        if confirmation.get("completion_message") or confirmation.get(
            "notify_on_confirmation", False
        ):
            await self._confirmation_support.async_send_completion(
                alert,
                event.context,
                confirmed_by,
                record_history=True,
            )

        if confirmation.get("actions_enabled", False):
            await self._action_runner.async_run_confirmation_actions(
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
        confirmation = alert["notification"].get("confirmation", {})

        if confirmation.get("clear_on_confirmation", True):
            try:
                await self.dispatcher.async_clear(alert, context=event.context)
            except Exception:
                _LOGGER.exception("Failed to clear draft notification")

        if confirmation.get("completion_message") or confirmation.get(
            "notify_on_confirmation", False
        ):
            await self._confirmation_support.async_send_completion(
                alert,
                event.context,
                confirmed_by,
                test=True,
            )

        if confirmation.get("actions_enabled", False):
            await self._action_runner.async_run_draft_confirmation_actions(
                alert,
                event.context,
                confirmed_by,
            )

    def _resolve_user(
        self,
        user_id: str | None,
    ) -> str:
        """Resolve a Home Assistant user to a person."""

        if not user_id:
            return "Unknown user"

        return resolve_user(getattr(self, "hass", None), user_id)

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

        normalized = normalize_config(
            {
                "version": 1,
                "alerts": [alert],
            }
        )["alerts"][0]

        delivery = self._draft_store.create(normalized, dt_util.utcnow())
        delivery_alert = delivery.alert
        session_id = delivery_alert["id"]
        if hasattr(self, "hass") and hasattr(self, "_tasks"):
            self._schedule(
                self._async_expire_draft_session(session_id, delivery.expires_at)
            )

        confirmation = delivery_alert["notification"].get("confirmation", {})
        confirmation_action_id = None
        if confirmation.get("enabled", False):
            confirmation_action_id = f"NC_DRAFT_CONFIRM_{uuid.uuid4().hex}"
            self._draft_store.register_action(
                confirmation_action_id,
                session_id,
                delivery_alert,
            )

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

        self._draft_store.expire(dt_util.utcnow())

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

        self._draft_store.discard(session_id)

    async def async_discard_draft_test(self, session_id: str) -> None:
        """Explicitly dispose an editor draft test session."""

        self._expire_draft_sessions()
        self._discard_draft_session(session_id)

    async def async_save_alert(
        self,
        alert: dict[str, Any],
    ) -> dict[str, Any]:
        """Create or update an alert."""

        return await self._config_api.async_save_alert(alert)

    async def async_delete_alert(
        self,
        alert_id: str,
    ) -> None:
        """Delete an alert."""

        await self._config_api.async_delete_alert(alert_id)

    async def async_validate_yaml(
        self,
        text: str,
    ) -> dict[str, Any]:
        """Validate raw YAML without changing the saved config."""

        return await self._config_api.async_validate_yaml(text)

    async def async_validate_conditions(
        self,
        alert: dict[str, Any],
    ) -> bool:
        """Validate alert conditions without changing saved config."""

        return await self._config_api.async_validate_conditions(alert)

    async def async_save_yaml(
        self,
        text: str,
    ) -> dict[str, Any]:
        """Replace configuration using raw YAML."""

        return await self._config_api.async_save_yaml(text)

    async def async_get_yaml(
        self,
    ) -> str:
        """Return YAML."""

        return await self._config_api.async_get_yaml()

    async def async_list_alerts(
        self,
    ) -> list[dict[str, Any]]:
        """Return alerts with runtime information."""

        return await self._config_api.async_list_alerts()

    async def async_history(
        self,
        alert_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Return trace history."""

        return await self._config_api.async_history(alert_id, limit)

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
