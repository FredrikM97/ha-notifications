"""The controller kernel: the only imperative shell in the integration.

Owns the single `HomeAssistantGateway`, wires every pure module together,
and is the only thing `bridge/websocket.py` calls. Every actual
decision (message content, recipients, trigger timing, follow-up actions)
is made by a pure module in this package; this file only sequences those
calls and dispatches the `Command`s they return.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any

from homeassistant.core import Event, HomeAssistant

from ..const import (
    CONFIG_FILENAME,
    DOMAIN,
    EVENT_NOTIFICATION_ACTION,
    STORAGE_KEY,
    STORAGE_VERSION,
    HistoryEventType,
    TransitionKind,
)
from ..bridge import panel as panel_module
from ..bridge import websocket as frontend_websocket
from ..domain.condition_schema import compile_condition
from ..ha.gateway import HomeAssistantGateway
from ..support import history as history_module
from ..support import storage as storage_module
from . import actions as actions_module
from . import alerts as alerts_module
from . import notifications as notifications_module
from . import responses as responses_module
from .commands import (
    CallService,
    Command,
    PersistSave,
    TrackInterval,
    TrackTemplate,
    Unsubscribe,
)

_LOGGER = logging.getLogger(__name__)


class NotificationCenterController:
    """The brain: wiring, setup, delegation decisions, public API."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._gateway = HomeAssistantGateway(hass)
        self._store = self._gateway.make_store(STORAGE_VERSION, STORAGE_KEY)

        self._state: dict[str, Any] = {"alerts": {}, "history": []}
        self._alerts: dict[str, dict[str, Any]] = {}
        self._sessions: dict[str, dict[str, Any]] = {}

        self._condition_unsubs: dict[str, Any] = {}
        self._interval_unsubs: dict[str, Any] = {}
        self._action_event_unsub: Any = None
        self._started_unsub: Any = None

        self._tasks: set[asyncio.Task[Any]] = set()
        self._started = False
        self._reload_lock = asyncio.Lock()

    @property
    def alerts(self) -> dict[str, dict[str, Any]]:
        """Expose the normalized alerts currently loaded (used by `__init__.py`)."""

        return self._alerts

    # ------------------------------------------------------------------
    # Setup / unload
    # ------------------------------------------------------------------

    async def async_setup(self, *, show_in_sidebar: bool) -> None:
        """Load config/state, start watchers, and register the frontend."""

        raw_state = await self._gateway.load_store(self._store)
        self._state = storage_module.ensure_runtime_state_shape(raw_state)

        config = await self._load_config()
        await self._apply_config(config)
        self._rebuild_sessions()

        self._action_event_unsub = self._gateway.bus_listen(
            EVENT_NOTIFICATION_ACTION, self._on_action_event
        )

        await self._register_frontend(show_in_sidebar=show_in_sidebar)
        frontend_websocket.register(self, self._gateway.register_websocket_command)

        if self._gateway.is_running:
            self._started = True
            await self._evaluate_all(source="startup")
        else:
            self._started_unsub = self._gateway.bus_listen_once(
                "homeassistant_started", self._on_home_assistant_started
            )

        _LOGGER.info("HA Notifications loaded %d alert(s)", len(self._alerts))

    async def _register_frontend(self, *, show_in_sidebar: bool) -> None:
        plan = panel_module.registration_plan(show_in_sidebar=show_in_sidebar)
        await self._gateway.register_static_path(plan.static_url, plan.static_directory)
        self._gateway.register_extra_js(plan.module_url)

        if not self._gateway.panel_exists(plan.frontend_url_path):
            await self._gateway.register_panel(
                frontend_url_path=plan.frontend_url_path,
                webcomponent_name=plan.webcomponent_name,
                module_url=plan.module_url,
                sidebar_title=plan.sidebar_title,
                sidebar_icon=plan.sidebar_icon,
            )

    async def _on_home_assistant_started(self, _event: Event) -> None:
        self._started = True
        await self._evaluate_all(source="startup")

    async def async_unload(self) -> bool:
        """Unload the controller."""

        if self._started_unsub:
            self._started_unsub()
            self._started_unsub = None

        if self._action_event_unsub:
            self._action_event_unsub()
            self._action_event_unsub = None

        for key in list(self._condition_unsubs) + list(self._interval_unsubs):
            self._unsubscribe(key)

        for task in list(self._tasks):
            if not task.done():
                task.cancel()

        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

        try:
            self._gateway.unregister_panel(DOMAIN)
        except Exception:
            _LOGGER.exception("Failed to unregister HA Notifications frontend")

        await self._gateway.save_store(self._store, self._state)

        return True

    # ------------------------------------------------------------------
    # The kernel dispatcher
    # ------------------------------------------------------------------

    async def _execute(self, command: Command) -> None:
        """Execute one Command against the gateway. The only place that does."""

        if isinstance(command, CallService):
            await self._gateway.call_service(
                command.domain, command.service, command.data, command.target
            )
        elif isinstance(command, TrackTemplate):
            self._unsubscribe(command.key)
            self._condition_unsubs[command.key] = self._gateway.track_template(
                command.template, self._make_condition_callback(command.key)
            )
        elif isinstance(command, TrackInterval):
            interval_unsub = self._interval_unsubs.pop(command.key, None)
            if interval_unsub:
                interval_unsub()
            self._interval_unsubs[command.key] = self._gateway.track_interval(
                command.interval, self._make_interval_callback(command.key)
            )
        elif isinstance(command, Unsubscribe):
            self._unsubscribe(command.key)
        elif isinstance(command, PersistSave):
            self._gateway.delay_save_store(self._store, command.data)

    def _unsubscribe(self, key: str) -> None:
        unsub = self._condition_unsubs.pop(key, None)
        if unsub:
            unsub()
        interval_unsub = self._interval_unsubs.pop(key, None)
        if interval_unsub:
            interval_unsub()

    def _make_condition_callback(self, alert_id: str):
        def _callback(
            active: bool | None, error: str | None, _event: Event | None
        ) -> None:
            self._schedule(
                self._on_condition_result(alert_id, active, error, source="change")
            )

        return _callback

    def _make_interval_callback(self, alert_id: str):
        def _callback(_now: Any) -> None:
            self._schedule(self._interval_tick(alert_id))

        return _callback

    def _schedule(self, coroutine: Any) -> None:
        task = self._gateway.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # ------------------------------------------------------------------
    # Config load/apply/reload
    # ------------------------------------------------------------------

    async def _load_config(self) -> dict[str, Any]:
        path = Path(self._gateway.config_path(CONFIG_FILENAME))
        if not path.exists():
            await self._gateway.write_text_file(
                path, storage_module.default_config_yaml_text()
            )
            return dict(storage_module.DEFAULT_CONFIG)

        text = await self._gateway.read_text_file(path)
        return storage_module.normalize_and_validate_yaml(text)

    async def _save_config(self, config: dict[str, Any]) -> dict[str, Any]:
        normalized, text = storage_module.normalize_and_dump_yaml(config)
        await self._gateway.write_text_file(
            Path(self._gateway.config_path(CONFIG_FILENAME)), text
        )
        return normalized

    async def _apply_config(self, config: dict[str, Any]) -> set[str]:
        previous_alerts = self._alerts

        for key in list(self._condition_unsubs) + list(self._interval_unsubs):
            self._unsubscribe(key)

        self._alerts = {alert["id"]: alert for alert in config["alerts"]}
        newly_enabled_alert_ids: set[str] = set()

        for alert_id in list(self._state["alerts"]):
            if alert_id not in self._alerts:
                del self._state["alerts"][alert_id]

        for alert in self._alerts.values():
            alerts_module.ensure_runtime_state(self._state["alerts"], alert)

            if alert.get("enabled", True):
                previous = previous_alerts.get(alert["id"])
                if previous is not None and not previous.get("enabled", True):
                    newly_enabled_alert_ids.add(alert["id"])

                for command in alerts_module.register_specs(alert):
                    await self._execute(command)

        return newly_enabled_alert_ids

    async def reload(self) -> None:
        """Reload configuration from disk."""

        async with self._reload_lock:
            config = await self._load_config()
            newly_enabled_alert_ids = await self._apply_config(config)
            self._rebuild_sessions()

            if self._started:
                for alert_id in newly_enabled_alert_ids:
                    alert = self._alerts.get(alert_id)
                    if alert is not None:
                        await self._evaluate_alert(alert, source="enabled")

                await self._evaluate_all(source="reload")

    def _rebuild_sessions(self) -> None:
        self._sessions.clear()
        now = self._gateway.now_utc()
        for alert_id, state in self._state["alerts"].items():
            action_id = state.get("confirmation_action_id")
            if action_id:
                responses_module.track(
                    self._sessions, action_id, now=now, alert_id=alert_id
                )

    # ------------------------------------------------------------------
    # Trigger evaluation (was AlertEngine.evaluate_all/evaluate_alert)
    # ------------------------------------------------------------------

    async def _evaluate_all(self, *, source: str) -> None:
        for alert in list(self._alerts.values()):
            if not alert.get("enabled", True):
                continue
            if source == "startup" and not alert.get("monitor", {}).get(
                "startup", True
            ):
                continue
            await self._evaluate_alert(alert, source=source)

    async def _evaluate_alert(self, alert: dict[str, Any], *, source: str) -> None:
        if not self._started:
            return

        active, error = await self._gateway.evaluate_condition(compile_condition(alert))
        await self._on_condition_result(alert["id"], active, error, source=source)

    async def _interval_tick(self, alert_id: str) -> None:
        alert = self._alerts.get(alert_id)
        if alert is not None:
            await self._evaluate_alert(alert, source="interval")

    # ------------------------------------------------------------------
    # Trigger decisions -> delegation (was AlertEngine.process_condition)
    # ------------------------------------------------------------------

    async def _on_condition_result(
        self, alert_id: str, active: bool | None, error: str | None, *, source: str
    ) -> None:
        alert = self._alerts.get(alert_id)
        if alert is None:
            return

        now = self._gateway.now_utc()
        transition = alerts_module.on_condition_result(
            self._state["alerts"], alert, active, error, now, source=source
        )

        if transition.kind == TransitionKind.CONDITION_ERROR:
            await self._record_history(
                alert,
                HistoryEventType.CONDITION_ERROR,
                "Template evaluation failed.",
                {"error": transition.error, "source": source},
            )
            return

        if transition.kind == TransitionKind.NO_CHANGE:
            return

        if transition.kind == TransitionKind.BECAME_INACTIVE:
            if transition.had_pending_confirmation:
                await self._clear_notification(alert)
            await self._record_history(
                alert,
                HistoryEventType.CONDITION_INACTIVE,
                "Condition became false.",
                {"source": source},
            )
            return

        # became_active or should_send
        if transition.kind == TransitionKind.BECAME_ACTIVE:
            await self._record_history(
                alert,
                HistoryEventType.CONDITION_ACTIVE,
                "Condition became true.",
                {"source": source},
            )

        if transition.new_confirmation_action and transition.confirmation_action_id:
            responses_module.track(
                self._sessions,
                transition.confirmation_action_id,
                now=now,
                alert_id=alert["id"],
            )

        if transition.replace_existing:
            await self._clear_notification(alert)

        await self._send_notification(
            alert, transition.attempt, transition.confirmation_action_id, now
        )

    # ------------------------------------------------------------------
    # Sending / clearing (delegates to controller/notifications.py)
    # ------------------------------------------------------------------

    def _send_variables(
        self,
        alert: dict[str, Any],
        attempt: int,
        confirmation_action_id: str | None,
        now: datetime,
        *,
        test: bool,
    ) -> dict[str, Any]:
        return {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "attempt": attempt,
            "test": test,
            "now": now,
            "notification_id": f"notification_center_{alert['id']}",
            "confirmation_action_id": confirmation_action_id,
        }

    async def _fetch_registry_snapshot(self) -> notifications_module.RegistrySnapshot:
        mobile_app_entries = self._gateway.config_entries_for_domain("mobile_app")
        return notifications_module.RegistrySnapshot(
            area_registry=self._gateway.area_registry_snapshot(),
            device_registry=self._gateway.device_registry_snapshot(),
            entity_registry=self._gateway.entity_registry_snapshot(),
            mobile_app_entries=mobile_app_entries,
            mobile_app_entry_ids={entry.entry_id for entry in mobile_app_entries},
            person_states=self._gateway.get_states_all("person"),
        )

    async def _send_notification(
        self,
        alert: dict[str, Any],
        attempt: int,
        confirmation_action_id: str | None,
        now: datetime,
    ) -> None:
        """Real (trigger-driven) send - updates runtime state and history."""

        variables = self._send_variables(
            alert, attempt, confirmation_action_id, now, test=False
        )
        snapshot = await self._fetch_registry_snapshot()

        try:
            commands_to_run = await notifications_module.compose_send(
                alert,
                variables,
                confirmation_action_id,
                snapshot,
                self._gateway.render_template,
                self._gateway.has_service,
            )
            for command in commands_to_run:
                await self._execute(command)
        except Exception as err:  # noqa: BLE001 - recorded, not re-raised, matching original
            alerts_module.record_send_result(
                self._state["alerts"],
                alert,
                attempt,
                now,
                success=False,
                error=str(err),
            )
            await self._record_history(
                alert,
                HistoryEventType.NOTIFICATION_FAILED,
                "Notification failed.",
                {"attempt": attempt, "error": str(err)},
            )
            return

        alerts_module.record_send_result(
            self._state["alerts"], alert, attempt, now, success=True
        )
        await self._record_history(
            alert,
            HistoryEventType.NOTIFICATION_SENT,
            "Notification sent.",
            {"attempt": attempt},
        )

        if alert["notification"].get("actions_enabled", False):
            await self._run_configured_actions(
                alert,
                alert["notification"].get("actions", []),
                variables,
                HistoryEventType.NOTIFICATION_ACTION,
                HistoryEventType.NOTIFICATION_ACTION_FAILED,
            )

    async def _clear_notification(self, alert: dict[str, Any]) -> None:
        now = self._gateway.now_utc()
        variables = {"alert_id": alert["id"], "alert_name": alert["name"], "now": now}
        snapshot = await self._fetch_registry_snapshot()

        try:
            commands_to_run = await notifications_module.compose_clear(
                alert,
                variables,
                snapshot,
                self._gateway.render_template,
                self._gateway.has_service,
            )
        except Exception:
            _LOGGER.exception("Failed clearing notification for %s", alert["id"])
            return

        for command in commands_to_run:
            await self._execute(command)

    async def _run_configured_actions(
        self,
        alert: dict[str, Any],
        action_list: list[dict[str, Any]],
        variables: dict[str, Any],
        success_type: HistoryEventType,
        failure_type: HistoryEventType,
        *,
        record_history: bool = True,
    ) -> None:
        results = await actions_module.build_service_calls(
            action_list, variables, self._gateway.render_template
        )

        for result in results:
            if result.command is None:
                if record_history:
                    await self._record_history(
                        alert,
                        failure_type,
                        "Action failed.",
                        {"index": result.index, "error": result.error},
                    )
                continue

            try:
                await self._execute(result.command)
            except Exception as err:  # noqa: BLE001 - recorded per-action, matching original
                if record_history:
                    await self._record_history(
                        alert,
                        failure_type,
                        "Action failed.",
                        {"index": result.index, "error": str(err)},
                    )
                continue

            if record_history:
                await self._record_history(
                    alert,
                    success_type,
                    "Action executed.",
                    {
                        "index": result.index,
                        "action": f"{result.command.domain}.{result.command.service}",
                    },
                )

    async def _record_history(
        self,
        alert: dict[str, Any],
        event_type: HistoryEventType,
        message: str,
        details: dict[str, Any],
    ) -> None:
        state = alerts_module.ensure_runtime_state(self._state["alerts"], alert)
        entry = history_module.format_entry(
            alert,
            event_type,
            message,
            details,
            now=self._gateway.now_utc(),
            flow_id=state.get("flow_id"),
        )
        self._state["history"] = history_module.append_entry(
            self._state["history"], entry
        )
        state["last_event"] = entry
        self._persist_state()

    def _persist_state(self) -> None:
        self._gateway.delay_save_store(self._store, self._state)

    # ------------------------------------------------------------------
    # Confirmation event handling (was ConfirmationActionHandler)
    # ------------------------------------------------------------------

    async def _on_action_event(self, event: Event) -> None:
        now = self._gateway.now_utc()
        outcome = responses_module.match_action_event(self._sessions, event.data, now)
        if outcome is None:
            return

        confirmed_by = responses_module.resolve_person_name(
            self._gateway.get_states_all("person"),
            event.context.user_id if event.context else None,
        )

        if outcome.is_draft:
            responses_module.clear(self._sessions, outcome.session_id)
            if outcome.draft_alert is not None:
                await self._run_confirmation_effects(
                    outcome.draft_alert,
                    confirmed_by,
                    now,
                    test=True,
                    record_history=False,
                )
            return

        alert = self._alerts.get(outcome.alert_id) if outcome.alert_id else None
        if alert is None:
            return

        state = alerts_module.ensure_runtime_state(self._state["alerts"], alert)
        if state.get("confirmation_action_id") != outcome.session_id:
            return

        responses_module.clear(self._sessions, outcome.session_id)
        alerts_module.mark_confirmed(self._state["alerts"], alert, confirmed_by, now)
        await self._record_history(
            alert,
            HistoryEventType.CONFIRMED,
            "Notification confirmed.",
            {"confirmed_by": confirmed_by},
        )

        await self._run_confirmation_effects(
            alert, confirmed_by, now, test=False, record_history=True
        )

    async def _run_confirmation_effects(
        self,
        alert: dict[str, Any],
        confirmed_by: str,
        now: datetime,
        *,
        test: bool,
        record_history: bool,
    ) -> None:
        confirmation = alert["notification"].get("confirmation", {})

        if confirmation.get("clear_on_confirmation", True):
            try:
                await self._clear_notification(alert)
            except Exception:
                _LOGGER.exception("Failed to clear notification for %s", alert["id"])

        if confirmation.get("completion_message") or confirmation.get(
            "notify_on_confirmation", False
        ):
            await self._send_completion_notification(
                alert, confirmed_by, now, test=test, record_history=record_history
            )

        if confirmation.get("actions_enabled", False):
            confirmation_variables = {
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "alert_active": True,
                "confirmed_by": confirmed_by,
                "now": now,
            }
            await self._run_configured_actions(
                alert,
                confirmation.get("actions", []),
                confirmation_variables,
                HistoryEventType.CONFIRMATION_ACTION,
                HistoryEventType.CONFIRMATION_ACTION_FAILED,
                record_history=record_history,
            )

    async def _send_completion_notification(
        self,
        alert: dict[str, Any],
        confirmed_by: str,
        now: datetime,
        *,
        test: bool,
        record_history: bool,
    ) -> None:
        completion_alert = await responses_module.build_completion_alert(
            alert, confirmed_by, now, self._gateway.render_template
        )
        if completion_alert is None:
            return

        variables = self._send_variables(completion_alert, 1, None, now, test=test)
        snapshot = await self._fetch_registry_snapshot()

        try:
            commands_to_run = await notifications_module.compose_send(
                completion_alert,
                variables,
                None,
                snapshot,
                self._gateway.render_template,
                self._gateway.has_service,
            )
            for command in commands_to_run:
                await self._execute(command)
        except Exception as err:
            if record_history:
                await self._record_history(
                    alert,
                    HistoryEventType.COMPLETION_FAILED,
                    "Completion notification failed.",
                    {"error": str(err)},
                )
            else:
                _LOGGER.exception("Failed to send draft completion notification")
            return

        if record_history:
            await self._record_history(
                alert,
                HistoryEventType.COMPLETION_SENT,
                "Completion notification sent.",
                {},
            )

    # ------------------------------------------------------------------
    # Public operations - called directly by bridge/websocket.py
    # ------------------------------------------------------------------

    async def list_alerts(self) -> list[dict[str, Any]]:
        """Return alerts with runtime information."""

        result = []
        for alert in self._alerts.values():
            state = alerts_module.ensure_runtime_state(self._state["alerts"], alert)
            result.append({**deepcopy(alert), "runtime": deepcopy(state)})
        return result

    async def save_alert(self, alert: dict[str, Any]) -> dict[str, Any]:
        """Create or update an alert.

        ``alert`` is expected to already be normalized - `bridge/websocket.py`
        normalizes every frontend payload before calling this.
        """

        config = await self._load_config()
        alert_list = list(config["alerts"])
        normalized = alert

        existing = next(
            (item for item in alert_list if item["id"] == normalized["id"]), None
        )
        now_iso = self._gateway.now_utc().isoformat()

        if existing:
            normalized["created_at"] = existing.get("created_at") or now_iso
            alert_list = [
                normalized if item["id"] == normalized["id"] else item
                for item in alert_list
            ]
        else:
            normalized["created_at"] = now_iso
            alert_list.append(normalized)

        normalized["updated_at"] = now_iso

        await self._save_config({"version": 1, "alerts": alert_list})
        await self.reload()

        return normalized

    async def delete_alert(self, alert_id: str) -> None:
        """Delete an alert."""

        alert = self._alerts.get(alert_id)
        if alert:
            try:
                await self._clear_notification(alert)
            except Exception:
                _LOGGER.exception(
                    "Failed clearing notification before deleting %s", alert_id
                )

        config = await self._load_config()
        config["alerts"] = [item for item in config["alerts"] if item["id"] != alert_id]
        await self._save_config(config)

        self._state["alerts"].pop(alert_id, None)
        self._state["history"] = history_module.remove_alert(
            self._state["history"], alert_id
        )

        await self.reload()
        self._persist_state()

    async def test_alert(self, alert_id: str) -> None:
        """Send a test notification for a saved alert."""

        alert = self._alerts.get(alert_id)
        if alert is None:
            raise ValueError(f"Unknown alert: {alert_id}")

        confirmation_action_id = self._create_test_action(alert)
        now = self._gateway.now_utc()
        variables = self._send_variables(
            alert, 1, confirmation_action_id, now, test=True
        )
        snapshot = await self._fetch_registry_snapshot()

        commands_to_run = await notifications_module.compose_send(
            alert,
            variables,
            confirmation_action_id,
            snapshot,
            self._gateway.render_template,
            self._gateway.has_service,
        )
        for command in commands_to_run:
            await self._execute(command)

        await self._record_history(
            alert, HistoryEventType.TEST, "Test notification sent.", {}
        )

    def _create_test_action(self, alert: dict[str, Any]) -> str | None:
        confirmation = alert["notification"].get("confirmation", {})
        if not confirmation.get("enabled", False):
            return None

        action_id = f"NC_TEST_CONFIRM_{uuid.uuid4().hex}"
        state = alerts_module.ensure_runtime_state(self._state["alerts"], alert)
        state["confirmation_action_id"] = action_id
        responses_module.track(
            self._sessions, action_id, now=self._gateway.now_utc(), alert_id=alert["id"]
        )
        return action_id

    async def test_alert_payload(self, alert: dict[str, Any]) -> dict[str, str | None]:
        """Send an already-normalized editor draft without saving or touching runtime state."""

        now = self._gateway.now_utc()

        session_id = f"NC_DRAFT_{uuid.uuid4().hex}"
        draft_alert = deepcopy(alert)
        draft_alert["id"] = session_id

        responses_module.track(
            self._sessions,
            session_id,
            now=now,
            draft_alert=draft_alert,
            ttl=responses_module.DRAFT_SESSION_TTL,
        )
        self._schedule(
            self._expire_draft_after_ttl(
                session_id, now + responses_module.DRAFT_SESSION_TTL
            )
        )

        confirmation = draft_alert["notification"].get("confirmation", {})
        confirmation_action_id = None
        if confirmation.get("enabled", False):
            confirmation_action_id = f"NC_DRAFT_CONFIRM_{uuid.uuid4().hex}"
            responses_module.track(
                self._sessions,
                confirmation_action_id,
                now=now,
                draft_alert=draft_alert,
                ttl=responses_module.DRAFT_SESSION_TTL,
            )

        variables = self._send_variables(
            draft_alert, 1, confirmation_action_id, now, test=True
        )
        snapshot = await self._fetch_registry_snapshot()

        commands_to_run = await notifications_module.compose_send(
            draft_alert,
            variables,
            confirmation_action_id,
            snapshot,
            self._gateway.render_template,
            self._gateway.has_service,
        )
        for command in commands_to_run:
            await self._execute(command)

        return {
            "session_id": session_id,
            "confirmation_action_id": confirmation_action_id,
        }

    async def _expire_draft_after_ttl(
        self, session_id: str, expires_at: datetime
    ) -> None:
        seconds = max(0, (expires_at - self._gateway.now_utc()).total_seconds())
        await asyncio.sleep(seconds)
        responses_module.expire_drafts(self._sessions, self._gateway.now_utc())

    async def discard_test_payload(self, session_id: str) -> None:
        """Explicitly dispose an editor draft test session."""

        now = self._gateway.now_utc()
        responses_module.expire_drafts(self._sessions, now)

        keys_to_clear = [session_id]
        keys_to_clear.extend(
            key
            for key, session in self._sessions.items()
            if session.get("draft_alert")
            and session["draft_alert"].get("id") == session_id
        )
        for key in keys_to_clear:
            responses_module.clear(self._sessions, key)

    async def get_history(
        self, alert_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Return trace history."""

        return history_module.list_entries(self._state["history"], alert_id, limit)

    async def get_yaml(self) -> str:
        """Return the raw YAML configuration text."""

        path = Path(self._gateway.config_path(CONFIG_FILENAME))
        if not path.exists():
            await self._gateway.write_text_file(
                path, storage_module.default_config_yaml_text()
            )

        return await self._gateway.read_text_file(path)

    async def validate_yaml(self, text: str) -> dict[str, Any]:
        """Validate raw YAML without changing the saved config."""

        return storage_module.normalize_and_validate_yaml(text)

    async def save_yaml(self, text: str) -> dict[str, Any]:
        """Replace configuration using raw YAML."""

        normalized = storage_module.normalize_and_validate_yaml(text)
        await self._gateway.write_text_file(
            Path(self._gateway.config_path(CONFIG_FILENAME)),
            storage_module.dump_yaml_text(normalized),
        )
        await self.reload()
        return normalized

    async def validate_conditions(self, alert: dict[str, Any]) -> bool:
        """Validate and evaluate already-normalized alert conditions without saving."""

        active, error = await self._gateway.evaluate_condition(
            compile_condition(alert)
        )
        if error is not None:
            raise ValueError(f"Condition template failed: {error}")
        return True


async def build_controller(hass: HomeAssistant) -> NotificationCenterController:
    """Construct the controller. The only place `__init__.py` should call."""

    return NotificationCenterController(hass)
