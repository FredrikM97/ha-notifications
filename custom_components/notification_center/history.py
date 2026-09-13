"""Alert history persistence and querying."""

from __future__ import annotations

import uuid
from copy import deepcopy
from typing import Any, Callable

from homeassistant.util import dt as dt_util

from .const import MAX_HISTORY
from .storage import NotificationStorage


class AlertHistory:
    """Maintain persisted alert event history."""

    def __init__(
        self,
        state: dict[str, Any],
        storage: NotificationStorage,
        get_runtime_state: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> None:
        self._state = state
        self._storage = storage
        self._get_runtime_state = get_runtime_state

    def set_state(self, state: dict[str, Any]) -> None:
        """Use a newly loaded persisted state mapping."""

        self._state = state

    async def record(
        self,
        alert: dict[str, Any],
        event_type: str,
        message: str,
        details: dict[str, Any],
    ) -> None:
        """Record an event and schedule its persistence."""

        runtime_state = self._get_runtime_state(alert)
        flow_id = runtime_state.get("flow_id")
        event = {
            "id": uuid.uuid4().hex,
            "timestamp": dt_util.utcnow().isoformat(),
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "type": event_type,
            "message": message,
            "details": deepcopy(details),
        }
        if flow_id:
            event["flow_id"] = flow_id

        self._state["history"].append(event)
        self._state["history"] = self._state["history"][-MAX_HISTORY:]
        runtime_state["last_event"] = event
        self._storage.async_delay_save_state(self._state)

    async def list(
        self,
        alert_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Return the newest matching history events first."""

        history = self._state["history"]
        if alert_id:
            history = [item for item in history if item.get("alert_id") == alert_id]

        return list(reversed(history[-max(1, min(limit, MAX_HISTORY)) :]))

    def remove_alert(self, alert_id: str) -> None:
        """Remove all events for a deleted alert."""

        self._state["history"] = [
            item for item in self._state["history"] if item.get("alert_id") != alert_id
        ]