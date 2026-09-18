"""Configuration and runtime-state storage owned by explicit storage classes."""

from __future__ import annotations

from typing import Any, cast

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from ..const import (
    STATE_HISTORY,
    STATE_RUNTIME,
    StateRoot,
)
from ..features.configuration import Configuration

DEFAULT_CONFIG: dict[str, Any] = {"version": 1, "alerts": []}


class RuntimeStateStorage:
    """Own loading and persistence of the mutable runtime state document."""

    def __init__(self, store: Any, state: StateRoot) -> None:
        self._store = store
        self._state = state

    async def load(self) -> None:
        """Replace state contents with the persisted runtime document."""

        loaded = ensure_runtime_state_shape(await self._store.async_load())
        self._state.clear()
        self._state.update(loaded)

    def persist(self) -> None:
        """Request a delayed save of current runtime state."""

        self._store.async_delay_save(lambda: self._state, 1)

    async def save(self) -> None:
        """Immediately persist runtime state during unload."""

        await self._store.async_save(self._state)

    async def remove(self) -> None:
        """Remove the integration-owned runtime state document."""

        await self._store.async_remove()


class ConfigEntryStorage:
    """Own the configuration document persisted in config-entry options."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self._hass = hass
        self._entry = entry

    def _options_config(self) -> dict[str, Any] | None:
        options = dict(self._entry.options)
        if "alerts" not in options:
            return None
        return Configuration.model_validate(options).model_dump(exclude_none=True)

    def _save_options(self, config: dict[str, Any]) -> dict[str, Any]:
        mapped = normalize_config(config)
        self._hass.config_entries.async_update_entry(
            self._entry,
            options=mapped,
        )
        return mapped

    async def load(self) -> dict[str, Any]:
        """Load the configuration from config-entry options."""

        configured = self._options_config()
        if configured is not None:
            return configured
        return self._save_options(dict(DEFAULT_CONFIG))

    async def save(self, config: dict[str, Any]) -> dict[str, Any]:
        """Validate and persist structured config-entry options."""

        return self._save_options(config)

    def validate(self, config: dict[str, Any]) -> dict[str, Any]:
        """Validate structured configuration without persisting it."""

        return normalize_config(config)


def normalize_config(config: Configuration | dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize the structured configuration document."""

    document = (
        config
        if isinstance(config, Configuration)
        else Configuration.model_validate(config)
    )
    mapped = document.model_dump(exclude_none=True)
    mapped_alerts = []
    for alert in document.alerts:
        mapped_alert = alert.model_dump(exclude_none=True)
        mapped_alert.pop("runtime", None)
        mapped_alerts.append(mapped_alert)
    mapped["alerts"] = mapped_alerts
    return mapped


def ensure_runtime_state_shape(raw: Any) -> StateRoot:
    """Return a runtime-state mapping with the expected top-level shape."""

    state = raw if isinstance(raw, dict) else {}
    state.setdefault(STATE_RUNTIME, {})
    state.setdefault(STATE_HISTORY, [])

    if not isinstance(state[STATE_RUNTIME], dict):
        state[STATE_RUNTIME] = {}

    if not isinstance(state[STATE_HISTORY], list):
        state[STATE_HISTORY] = []

    return cast(StateRoot, state)
