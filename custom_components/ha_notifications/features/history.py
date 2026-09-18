"""Record alert history as an explicit workflow operation."""

from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import datetime
from typing import Any

from ..const import (
    MAX_HISTORY,
    STATE_HISTORY,
    STATE_RUNTIME,
    HistoryEventType,
    StateRoot,
)
from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from ..support.storage import RuntimeStateStorage


class HistoryFeature(FeatureBase):
    """Own query access to persisted alert history."""

    name = "history"

    def __init__(
        self,
        _hass: Any,
        state: StateRoot,
        _config_storage: Any,
        runtime_storage: RuntimeStateStorage,
    ) -> None:
        super().__init__()
        self._state = state
        self._runtime_storage = runtime_storage

    def record(
        self,
        alert: dict[str, Any],
        event_type: HistoryEventType,
        message: str,
        details: dict[str, Any],
        now: Any,
    ) -> bool:
        """Record one user-visible history event for an active alert."""

        return self._record_event(
            self._state[STATE_RUNTIME].get(alert["id"]),
            alert,
            event_type,
            message,
            details,
            now,
        )

    def record_event(
        self,
        runtime_state: dict[str, Any] | None,
        alert: dict[str, Any],
        event_type: HistoryEventType,
        message: str,
        details: dict[str, Any],
        now: Any,
    ) -> bool:
        """Record an event through the history feature owner."""

        return self._record_event(
            runtime_state, alert, event_type, message, details, now
        )

    def record_notification_outcome(
        self,
        alert: dict[str, Any],
        *,
        success: bool,
        attempt: int,
        now: Any,
        error: str | None = None,
    ) -> bool:
        """Record the outcome of one notification attempt."""

        runtime_state = self._state[STATE_RUNTIME].get(alert["id"])
        if runtime_state is None:
            return False
        event_type = (
            HistoryEventType.NOTIFICATION_SENT
            if success
            else HistoryEventType.NOTIFICATION_FAILED
        )
        details: dict[str, Any] = {"attempt": attempt}
        if not success:
            details["error"] = error
        return self._record_event(
            runtime_state,
            alert,
            event_type,
            "Notification sent." if success else "Notification failed.",
            details,
            now,
        )

    def _record_event(
        self,
        runtime_state: dict[str, Any] | None,
        alert: dict[str, Any],
        event_type: HistoryEventType,
        message: str,
        details: dict[str, Any],
        now: Any,
    ) -> bool:
        """Append one history entry and update the owning runtime record."""

        if runtime_state is None:
            return False
        entry = self._format_entry(
            alert,
            event_type,
            message,
            details,
            now,
            runtime_state.get("flow_id"),
        )
        self._state[STATE_HISTORY] = append_entry(
            self._state[STATE_HISTORY], entry
        )
        runtime_state["last_event"] = entry
        return True

    @staticmethod
    def _format_entry(
        alert: dict[str, Any],
        event_type: HistoryEventType,
        message: str,
        details: dict[str, Any],
        now: Any,
        flow_id: str | None,
    ) -> dict[str, Any]:
        """Build one isolated persisted history entry."""

        entry: dict[str, Any] = {
            "id": uuid.uuid4().hex,
            "timestamp": now.isoformat(),
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "type": event_type,
            "message": message,
            "details": deepcopy(details),
        }
        if flow_id:
            entry["flow_id"] = flow_id
        return entry

    @websocket_route(
        "history.list",
        command="history",
        arguments=(
            WebsocketArgument("alert_id", str, required=False, default=None),
            WebsocketArgument("limit", int, required=False, default=100),
        ),
        error_code="history_failed",
        error_message="Unable to load history.",
    )
    async def list_history(
        self, alert_id: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Return persisted history owned by this feature."""

        return list_entries(self._state[STATE_HISTORY], alert_id, limit)


def format_entry(
    alert: dict[str, Any],
    event_type: HistoryEventType,
    message: str,
    details: dict[str, Any],
    *,
    now: datetime,
    flow_id: str | None = None,
) -> dict[str, Any]:
    """Build one history event record."""

    event: dict[str, Any] = {
        "id": uuid.uuid4().hex,
        "timestamp": now.isoformat(),
        "alert_id": alert["id"],
        "alert_name": alert["name"],
        "type": event_type,
        "message": message,
        "details": deepcopy(details),
    }
    if flow_id:
        event["flow_id"] = flow_id
    return event


def append_entry(
    history: list[dict[str, Any]], entry: dict[str, Any]
) -> list[dict[str, Any]]:
    """Append an entry, trimming to the configured history size."""

    history.append(entry)
    return history[-MAX_HISTORY:]


def list_entries(
    history: list[dict[str, Any]],
    alert_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Return the newest matching history events first."""

    filtered = history
    if alert_id:
        filtered = [item for item in filtered if item.get("alert_id") == alert_id]
    return list(reversed(filtered[-max(1, min(limit, MAX_HISTORY)) :]))


def remove_alert(history: list[dict[str, Any]], alert_id: str) -> list[dict[str, Any]]:
    """Return history with all events for a deleted alert removed."""

    return [item for item in history if item.get("alert_id") != alert_id]


def prune_entries(
    history: list[dict[str, Any]], retention_days: int | None, *, now: datetime
) -> list[dict[str, Any]]:
    """Remove entries older than the supplied retention period."""

    if retention_days is None:
        return list(history)
    cutoff = now.timestamp() - max(0, retention_days) * 86400
    result = []
    for entry in history:
        try:
            timestamp = datetime.fromisoformat(str(entry["timestamp"])).timestamp()
        except (KeyError, TypeError, ValueError):
            result.append(entry)
            continue
        if timestamp >= cutoff:
            result.append(entry)
    return result


def prune_entries_by_alert(
    history: list[dict[str, Any]], retention_by_alert: dict[str, int | None]
) -> list[dict[str, Any]]:
    """Apply each alert's retention policy to its history entries."""

    now = datetime.now().astimezone()
    result = []
    for entry in history:
        retention_days = retention_by_alert.get(entry.get("alert_id"))
        if retention_days is None:
            result.append(entry)
            continue
        result.extend(prune_entries([entry], retention_days, now=now))
    return result


def record_notification_outcome(
    state_root: dict[str, Any],
    alert: dict[str, Any],
    *,
    success: bool,
    attempt: int,
    now: Any,
    record_history: bool = True,
    error: str | None = None,
) -> bool:
    """Record a notification outcome after its service batch completes."""

    if not record_history:
        return False

    runtime_state = state_root[STATE_RUNTIME].get(alert["id"])
    if runtime_state is None:
        return False

    event_type = (
        HistoryEventType.NOTIFICATION_SENT
        if success
        else HistoryEventType.NOTIFICATION_FAILED
    )
    details: dict[str, Any] = {"attempt": attempt}
    if not success:
        details["error"] = error
    entry = format_entry(
        alert,
        event_type,
        "Notification sent." if success else "Notification failed.",
        details,
        now=now,
        flow_id=runtime_state.get("flow_id"),
    )
    state_root[STATE_HISTORY] = append_entry(state_root[STATE_HISTORY], entry)
    runtime_state["last_event"] = entry
    return True


def record_event(
    state_root: dict[str, Any],
    runtime_state: dict[str, Any] | None,
    alert: dict[str, Any],
    event_type: HistoryEventType,
    message: str,
    details: dict[str, Any],
    now: Any,
) -> bool:
    if runtime_state is None:
        return False

    entry = format_entry(
        alert,
        event_type,
        message,
        details,
        now=now,
        flow_id=runtime_state.get("flow_id"),
    )
    state_root[STATE_HISTORY] = append_entry(state_root[STATE_HISTORY], entry)
    runtime_state["last_event"] = entry

    return True
