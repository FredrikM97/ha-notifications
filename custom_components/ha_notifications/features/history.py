"""Record alert history as an explicit workflow operation."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback

from ..const import (
    EVENT_ALERT_EVENT,
    MAX_HISTORY,
)
from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from ..support.storage import Storage


class HistoryFeature(FeatureBase):
    """Own query access to persisted alert history."""

    name = "history"

    @classmethod
    def create(
        cls,
        hass: HomeAssistant,
        _runtime: dict[str, Any],
        storage: Storage,
    ) -> HistoryFeature:
        """Construct history with only its owned dependencies."""

        return cls(hass, storage)

    def __init__(
        self,
        hass: HomeAssistant,
        storage: Storage,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._storage = storage
        self._event_unsub: Any = None
        self._event_tasks: set[asyncio.Task[Any]] = set()

    async def on_setup(self) -> None:
        """Listen for completed alert facts and persist them independently."""

        self._event_unsub = self._hass.bus.async_listen(
            EVENT_ALERT_EVENT, self._handle_alert_event
        )

    async def on_unload(self) -> None:
        """Release the alert event listener owned by this feature."""

        if self._event_unsub is not None:
            self._event_unsub()
            self._event_unsub = None
        if self._event_tasks:
            await asyncio.gather(*self._event_tasks, return_exceptions=True)
            self._event_tasks.clear()

    @callback
    def _handle_alert_event(self, event: Event) -> None:
        """Schedule persistence for one raw alert event."""

        task = self._hass.async_create_task(self._storage.store_event(event.data))
        self._event_tasks.add(task)
        task.add_done_callback(self._event_tasks.discard)

    async def remove_alert(self, alert_id: str) -> None:
        """Remove history entries belonging to a discarded preview alert."""

        await self._storage.remove_history_for_alert(alert_id)

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

        await self._storage.load_history()
        return list_entries(self._storage.history, alert_id, limit)


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
        filtered = [item for item in filtered if item["alert"]["id"] == alert_id]
    return list(reversed(filtered[-max(1, min(limit, MAX_HISTORY)) :]))


def remove_alert(history: list[dict[str, Any]], alert_id: str) -> list[dict[str, Any]]:
    """Return history with all events for a deleted alert removed."""

    return [item for item in history if item["alert"]["id"] != alert_id]


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
            timestamp = datetime.fromisoformat(
                str(entry["event"]["timestamp"])
            ).timestamp()
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
        retention_days = retention_by_alert.get(str(entry["alert"]["id"]))
        if retention_days is None:
            result.append(entry)
            continue
        try:
            timestamp = datetime.fromisoformat(
                str(entry["event"]["timestamp"])
            ).timestamp()
        except (KeyError, TypeError, ValueError):
            result.append(entry)
            continue
        cutoff = now.timestamp() - max(0, retention_days) * 86400
        if timestamp >= cutoff:
            result.append(entry)
    return result


