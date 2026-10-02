"""Persistent delivery history for HA Notifications."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

_STORAGE_VERSION = 1
_STORAGE_KEY = "ha_notifications.history"
_MAX_ENTRIES = 500
_RETENTION_DAYS = 30


class HistoryStore:
    """Persist and retrieve alert delivery events."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store = Store[dict[str, Any]](hass, _STORAGE_VERSION, _STORAGE_KEY)
        self._entries: list[dict[str, Any]] = []
        self._loaded = False
        self._lock = asyncio.Lock()

    async def async_load(self) -> None:
        """Load and prune persisted history."""
        if self._loaded:
            return
        async with self._lock:
            if self._loaded:
                return
            data = await self._store.async_load()
            entries = data.get("entries", []) if isinstance(data, dict) else []
            self._entries = [entry for entry in entries if isinstance(entry, dict)]
            self._prune()
            self._loaded = True

    async def async_record(
        self,
        alert_id: str,
        alert_name: str,
        event_type: str,
        message: str,
        details: dict[str, Any] | None = None,
        flow_id: str | None = None,
    ) -> None:
        """Record one successful delivery event."""
        await self.async_load()
        async with self._lock:
            timestamp = datetime.now(timezone.utc).isoformat()
            event = {
                "event_id": str(uuid4()),
                "timestamp": timestamp,
                "type": event_type,
                "message": message,
                "details": details or {},
            }
            if flow_id:
                event["flow_id"] = flow_id
            self._entries.insert(0, {
                "config": {"id": alert_id, "name": alert_name},
                "event": event,
            })
            self._prune()
            await self._store.async_save({"entries": self._entries})

    async def async_record_inactive(
        self,
        alert_id: str,
        alert_name: str,
        message: str,
        details: dict[str, Any] | None = None,
        flow_id: str | None = None,
    ) -> bool:
        """Record each inactive period and report whether it followed activity."""
        await self.async_load()
        async with self._lock:
            previous_state = None
            for entry in self._entries:
                config = entry.get("config")
                event = entry.get("event")
                if not isinstance(config, dict) or config.get("id") != alert_id:
                    continue
                if not isinstance(event, dict):
                    continue
                event_type = event.get("type")
                if event_type in {"started", "notification_sent", "inactive"}:
                    previous_state = event_type
                    break
            if previous_state == "inactive":
                return False
            active_transition = previous_state in {"started", "notification_sent"}
            timestamp = datetime.now(timezone.utc).isoformat()
            event = {
                "event_id": str(uuid4()),
                "timestamp": timestamp,
                "type": "inactive",
                "message": message,
                "details": details or {},
            }
            if flow_id:
                event["flow_id"] = flow_id
            self._entries.insert(0, {
                "config": {"id": alert_id, "name": alert_name},
                "event": event,
            })
            self._prune()
            await self._store.async_save({"entries": self._entries})
            return active_transition

    async def async_entries(self, alert_id: str | None = None) -> list[dict[str, Any]]:
        """Return newest-first history entries."""
        await self.async_load()
        async with self._lock:
            if alert_id is None:
                return list(self._entries)
            return [
                entry
                for entry in self._entries
                if entry.get("config", {}).get("id") == alert_id
            ]

    def _prune(self) -> None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=_RETENTION_DAYS)
        retained: list[dict[str, Any]] = []
        for entry in self._entries:
            timestamp = entry.get("event", {}).get("timestamp")
            try:
                keep = datetime.fromisoformat(timestamp) >= cutoff
            except (TypeError, ValueError):
                keep = False
            if keep:
                retained.append(entry)
        self._entries = retained[:_MAX_ENTRIES]

def history_store(hass: HomeAssistant, entry: Any = None) -> HistoryStore:
    """Return the entry-owned history store, creating it when missing."""
    runtime_data = getattr(entry, "runtime_data", None)
    store = getattr(runtime_data, "history", None)
    if store is None:
        store = HistoryStore(hass)
        if runtime_data is not None and hasattr(runtime_data, "history"):
            runtime_data.history = store
    return store