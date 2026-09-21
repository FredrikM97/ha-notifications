"""Persistence for the configuration object and event state object."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from ..const import MAX_HISTORY, STATE_HISTORY, StateRoot

DEFAULT_CONFIG: dict[str, Any] = {"version": 1, "alerts": []}


class Storage:
    """Store the configuration object and the event state object."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        store: Any,
        state: StateRoot,
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._store = store
        self._state = state

    async def load_config(self) -> dict[str, Any]:
        """Return the configuration object stored on the config entry."""

        if "alerts" in self._entry.options:
            return self._entry.options

        self._hass.config_entries.async_update_entry(
            self._entry,
            options=DEFAULT_CONFIG,
        )
        return DEFAULT_CONFIG

    async def save_config(self, config: dict[str, Any]) -> dict[str, Any]:
        """Store the configuration object unchanged on the config entry."""

        self._hass.config_entries.async_update_entry(
            self._entry,
            options=config,
        )
        return config

    async def load_events(self) -> None:
        """Replace the shared event state with the stored event object."""

        loaded = await self._store.async_load()
        if loaded is None:
            return
        self._state.clear()
        self._state.update(loaded)

    def store_event(self, event: dict[str, Any]) -> None:
        """Store one event object and schedule the state object for saving."""

        self._state[STATE_HISTORY].append(event)
        self._state[STATE_HISTORY] = self._state[STATE_HISTORY][-MAX_HISTORY:]
        self.persist()

    def persist(self) -> None:
        """Schedule the current event state for saving."""

        self._store.async_delay_save(lambda: self._state, 1)

    async def save_events(self) -> None:
        """Store the current event state immediately during unload."""

        await self._store.async_save(self._state)

    async def remove_events(self) -> None:
        """Remove the stored event state."""

        await self._store.async_remove()
