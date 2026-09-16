"""Record alert history as an explicit workflow operation."""

from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any

from ..const import (
    DEFAULT_HISTORY_RETENTION_DAYS,
    EVENT_RUNTIME_PERSIST_REQUESTED,
    MAX_HISTORY,
    STATE_HISTORY,
    STATE_HISTORY_RETENTION_BY_ALERT,
    STATE_RUNTIME,
    HistoryEventType,
)
from ..controller.lifecycle import (
    FeatureBase,
    WebsocketArgument,
    route,
    websocket_route,
)


class HistoryFeature(FeatureBase):
    """Own query access to persisted alert history."""

    name = "history"

    @route("history.configure")
    async def configure(self, config: dict[str, Any]) -> bool:
        retention_by_alert = {}
        for alert in config.get("alerts", []):
            monitor = alert.get("monitor", {})
            retention = monitor.get("retention", {})
            if retention.get("enabled", True) is False:
                retention_by_alert[alert["id"]] = None
            else:
                retention_by_alert[alert["id"]] = int(
                    retention.get("days", DEFAULT_HISTORY_RETENTION_DAYS)
                )
        self.services.state[STATE_HISTORY_RETENTION_BY_ALERT] = retention_by_alert
        history = self.services.state[STATE_HISTORY]
        pruned = prune_entries_by_alert(history, retention_by_alert)
        self.services.state[STATE_HISTORY] = pruned
        if len(pruned) != len(history):
            self.services.hass.bus.async_fire(EVENT_RUNTIME_PERSIST_REQUESTED)
        return True

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
            self.services.state[STATE_RUNTIME].get(alert["id"]),
            alert,
            event_type,
            message,
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
        self.services.state[STATE_HISTORY] = append_entry(
            self.services.state[STATE_HISTORY],
            entry,
            retention_for_alert(alert),
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

        return list_entries(self.services.state[STATE_HISTORY], alert_id, limit)

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
    history: list[dict[str, Any]],
    entry: dict[str, Any],
    retention_days: int | None = None,
) -> list[dict[str, Any]]:
    """Append an entry, trimming by retention and maximum history size."""

    history.append(entry)
    if retention_days is not None:
        history = prune_entries(history, retention_days)
    return history[-MAX_HISTORY:]


def retention_for_alert(alert: dict[str, Any]) -> int | None:
    """Return an alert's configured history retention period, if present."""

    monitor = alert.get("monitor")
    if not isinstance(monitor, dict):
        return None
    retention = monitor.get("retention")
    if not isinstance(retention, dict):
        return None
    if retention.get("enabled", True) is False:
        return None
    value = retention.get("days")
    if value is None:
        return DEFAULT_HISTORY_RETENTION_DAYS
    return int(value)


def prune_entries(
    history: list[dict[str, Any]], retention_days: int, *, now: datetime | None = None
) -> list[dict[str, Any]]:
    """Keep entries newer than the configured retention period."""

    cutoff = (now or datetime.now(timezone.utc)) - timedelta(
        days=max(1, retention_days)
    )
    retained: list[dict[str, Any]] = []
    for entry in history:
        timestamp = entry.get("timestamp")
        try:
            parsed = datetime.fromisoformat(timestamp)
        except (TypeError, ValueError):
            retained.append(entry)
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        if parsed >= cutoff:
            retained.append(entry)
    return retained


def prune_entries_by_alert(
    history: list[dict[str, Any]], retention_by_alert: dict[str, int | None]
) -> list[dict[str, Any]]:
    """Prune each alert's entries using its configured retention period."""

    grouped: dict[str, list[dict[str, Any]]] = {}
    for entry in history:
        grouped.setdefault(str(entry.get("alert_id", "")), []).append(entry)

    retained: list[dict[str, Any]] = []
    for alert_id, entries in grouped.items():
        retention_days = retention_by_alert.get(
            alert_id, DEFAULT_HISTORY_RETENTION_DAYS
        )
        if retention_days is None:
            retained.extend(entries)
        else:
            retained.extend(prune_entries(entries, retention_days))
    return retained[-MAX_HISTORY:]


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
    state_root[STATE_HISTORY] = append_entry(
        state_root[STATE_HISTORY],
        entry,
        retention_for_alert(alert),
    )
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
    state_root[STATE_HISTORY] = append_entry(
        state_root[STATE_HISTORY],
        entry,
        retention_for_alert(alert),
    )
    runtime_state["last_event"] = entry

    return True
