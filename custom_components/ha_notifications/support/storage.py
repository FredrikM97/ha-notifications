"""Persistence for configuration and the alert event history."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from pydantic import ValidationError

from ..const import HISTORY_STORAGE_KEY, MAX_HISTORY, STORAGE_VERSION
from ..features.configuration import Configuration
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

    async def load_raw_config(self) -> dict[str, Any]:
        """Return a copy of the saved document without runtime validation."""

        options = self._entry.options
        if not isinstance(options, Mapping):
            return {"raw": _copy_config(options)}
        return _copy_config(dict(options))

    async def save_config(self, config: dict[str, Any]) -> dict[str, Any]:
        """Store the configuration object unchanged on the config entry."""

        Configuration.model_validate(config)
        for alert in config.get("alerts", []):
            _validate_alert(alert)
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
                self._history.extend(
                    _normalize_history_entry(entry) for entry in loaded[-MAX_HISTORY:]
                )
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
            item for item in self._history if item["config"]["id"] != alert_id
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


def _normalize_history_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Migrate the former persisted alert key to the canonical config key."""

    if "config" in entry or "alert" not in entry:
        return entry
    normalized = dict(entry)
    normalized["config"] = normalized.pop("alert")
    return normalized


def _copy_config(value: Any) -> Any:
    """Copy config mappings without requiring mutable concrete mapping types."""

    if isinstance(value, Mapping):
        return {key: _copy_config(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_copy_config(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_copy_config(item) for item in value)
    return value


def _validate_alert(alert: dict[str, Any]) -> None:
    """Validate the feature-owned sections required during runtime setup."""

    if not isinstance(alert, dict):
        raise TypeError("Alert must be an object")
    Configuration.model_validate({"version": 1, "alerts": [alert]})
    ConfirmationConfig.from_alert(alert)


def _prepare_loaded_config(config: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Remove invalid persisted alerts safely before runtime setup."""

    prepared = _copy_config(config)
    if not isinstance(prepared, dict):
        _LOGGER.warning("Discarding invalid persisted HA Notifications configuration")
        return DEFAULT_CONFIG.copy(), True

    alerts = prepared.get("alerts")
    if not isinstance(alerts, list):
        _LOGGER.warning("Discarding invalid persisted HA Notifications alert list")
        prepared["alerts"] = []
        Configuration.model_validate(prepared)
        return prepared, prepared != config

    valid_alerts: list[dict[str, Any]] = []
    removed = 0
    for alert in alerts:
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

    prepared["alerts"] = valid_alerts
    changed = prepared != config
    if changed:
        _LOGGER.warning(
            "Discarded invalid persisted HA Notifications data "
            "(removed %d alert(s))",
            removed,
        )
    Configuration.model_validate(prepared)
    return prepared, changed
