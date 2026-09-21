"""Record alert history as an explicit workflow operation."""

from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import datetime
from typing import Any

from ..const import (
    MAX_HISTORY,
    STATE_HISTORY,
    AlertEventType,
    StateRoot,
)
from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from ..support.storage import Storage


class HistoryFeature(FeatureBase):
    """Own query access to persisted alert history."""

    name = "history"

    def __init__(
        self,
        _hass: Any,
        state: StateRoot,
        _config_storage: Any,
        storage: Storage,
    ) -> None:
        super().__init__()
        self._state = state
        self._storage = storage

    async def remove_alert(self, alert_id: str) -> None:
        """Remove history entries belonging to a discarded preview alert."""

        self._state[STATE_HISTORY] = remove_alert(
            self._state[STATE_HISTORY], alert_id
        )
        self._storage.persist()

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
    event_type: AlertEventType,
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
        try:
            timestamp = datetime.fromisoformat(str(entry["timestamp"])).timestamp()
        except (KeyError, TypeError, ValueError):
            result.append(entry)
            continue
        cutoff = now.timestamp() - max(0, retention_days) * 86400
        if timestamp >= cutoff:
            result.append(entry)
    return result


