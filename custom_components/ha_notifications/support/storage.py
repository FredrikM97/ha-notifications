"""Persistence for configuration and the alert event history."""

from __future__ import annotations

import asyncio
import logging
from copy import deepcopy
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from pydantic import ValidationError

from ..const import HISTORY_STORAGE_KEY, MAX_HISTORY, STORAGE_VERSION
from ..features.configuration import Configuration
from ..features.conditions import MonitorConfig
from ..features.confirmations import ConfirmationConfig

_LOGGER = logging.getLogger(__name__)

DEFAULT_CONFIG: dict[str, Any] = {"version": 1, "alerts": []}


class Storage:
    """Store configuration and the alert event history."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._history_store = Store(hass, STORAGE_VERSION, HISTORY_STORAGE_KEY)
        self._history: list[dict[str, Any]] = []
        self._history_loaded = False
        self._history_lock = asyncio.Lock()

    @property
    def history(self) -> list[dict[str, Any]]:
        """Return the history owned by the history persistence boundary."""

        return self._history

    async def load_config(self) -> dict[str, Any]:
        """Return the configuration object stored on the config entry."""

        if "alerts" in self._entry.options:
            config, changed = _prepare_loaded_config(self._entry.options)
            if changed:
                self._hass.config_entries.async_update_entry(
                    self._entry,
                    options=config,
                )
            return config

        self._hass.config_entries.async_update_entry(
            self._entry,
            options=DEFAULT_CONFIG,
        )
        return DEFAULT_CONFIG

    async def save_config(self, config: dict[str, Any]) -> dict[str, Any]:
        """Store the configuration object unchanged on the config entry."""

        Configuration.model_validate(config)
        self._hass.config_entries.async_update_entry(
            self._entry,
            options=config,
        )
        return config

    async def load_history(self) -> None:
        """Load persisted history into the history feature boundary."""

        if self._history_loaded:
            return
        async with self._history_lock:
            if self._history_loaded:
                return
            loaded = await self._history_store.async_load()
            if loaded is not None:
                self._history.clear()
                self._history.extend(loaded[-MAX_HISTORY:])
            self._history_loaded = True

    async def store_event(self, event: dict[str, Any]) -> None:
        """Store one event object and schedule history for saving."""

        await self.load_history()
        self._history.append(event)
        del self._history[:-MAX_HISTORY]
        self.persist_history()

    async def remove_history_for_alert(self, alert_id: str) -> None:
        """Remove one alert's history and schedule the updated log for saving."""

        await self.load_history()
        self._history[:] = [
            item for item in self._history if item["alert"]["id"] != alert_id
        ]
        self.persist_history()

    def persist_history(self) -> None:
        """Schedule the current history list for saving."""

        self._history_store.async_delay_save(lambda: self._history, 1)

    async def save_history(self) -> None:
        """Store history immediately during unload."""

        await self.load_history()
        await self._history_store.async_save(self._history)

    async def remove_history(self) -> None:
        """Remove persisted history."""

        await self._history_store.async_remove()


def _duration_seconds(value: Any) -> int | float | None:
    """Convert a legacy Home Assistant duration value to seconds."""

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    if not isinstance(value, str):
        return value
    parts = value.split(":")
    if len(parts) not in (2, 3):
        raise ValueError(f"Invalid duration {value!r}")
    try:
        numbers = [float(part) for part in parts]
    except ValueError as err:
        raise ValueError(f"Invalid duration {value!r}") from err
    if len(numbers) == 2:
        numbers.insert(0, 0)
    seconds = numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    return int(seconds) if seconds.is_integer() else seconds


def _normalize_legacy_durations(config: dict[str, Any]) -> dict[str, Any]:
    """Return a copy with legacy UI duration strings represented as seconds."""

    normalized = deepcopy(config)
    for alert in normalized.get("alerts", []):
        monitor = alert.get("monitor") or {}
        if "interval" in monitor:
            monitor["interval"] = _duration_seconds(monitor["interval"])
        for condition in alert.get("conditions") or []:
            if "for" in condition:
                condition["for"] = _duration_seconds(condition["for"])
        reminders = (alert.get("confirmation") or {}).get("reminders") or {}
        for field in ("interval", "timeout"):
            if field in reminders:
                reminders[field] = _duration_seconds(reminders[field])
    return normalized


def _validate_alert(alert: dict[str, Any]) -> None:
    """Validate the feature-owned sections required during runtime setup."""

    Configuration.model_validate({"version": 1, "alerts": [alert]})
    MonitorConfig.model_validate(alert.get("monitor") or {})
    ConfirmationConfig.from_alert(alert)


def _prepare_loaded_config(config: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Migrate legacy durations and remove invalid persisted alerts safely."""

    normalized = _normalize_legacy_durations(config)
    valid_alerts: list[dict[str, Any]] = []
    removed = 0
    for alert in normalized.get("alerts", []):
        try:
            _validate_alert(alert)
        except (ValidationError, TypeError, ValueError) as err:
            removed += 1
            _LOGGER.warning(
                "Removing invalid persisted HA Notifications alert %r: %s",
                alert.get("id"),
                err,
            )
            continue
        valid_alerts.append(alert)

    prepared = {**normalized, "alerts": valid_alerts}
    changed = prepared != config
    if changed:
        reason = "legacy duration values" if prepared == normalized else "invalid alerts"
        _LOGGER.warning(
            "Repaired HA Notifications configuration on startup (%s; removed %d alert(s))",
            reason,
            removed,
        )
    Configuration.model_validate(prepared)
    return prepared, changed
