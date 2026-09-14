"""Pure alert history formatting/querying - no Home Assistant import.

`controller/core.py` owns the actual persisted `history` list (part of the
runtime-state blob it loads/saves via `ha/gateway.py`); this module only
builds entries and queries a list it's handed.
"""

from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import datetime
from typing import Any

from ..const import MAX_HISTORY, HistoryEventType


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
