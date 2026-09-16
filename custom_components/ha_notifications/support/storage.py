"""YAML and runtime-state storage owned by explicit storage classes."""

from __future__ import annotations

from typing import Any, cast

import yaml
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback

from ..const import (
    EVENT_RUNTIME_PERSIST_REQUESTED,
    STATE_HISTORY,
    STATE_RUNTIME,
    StateRoot,
)
from ..features.configuration import Configuration

DEFAULT_CONFIG: dict[str, Any] = {"version": 1, "alerts": []}


class RuntimeStateStorage:
    """Own loading and persistence of the mutable runtime state document."""

    def __init__(self, hass: HomeAssistant, store: Any, state: StateRoot) -> None:
        self._hass = hass
        self._store = store
        self._state = state
        self._unsubscribe: Any = None

    def start(self) -> None:
        """Listen for runtime persistence requests from feature workflows."""

        @callback
        def _persist_on_event(_event: Any) -> None:
            self.persist()

        self._unsubscribe = self._hass.bus.async_listen(
            EVENT_RUNTIME_PERSIST_REQUESTED, _persist_on_event
        )

    def stop(self) -> None:
        """Remove the persistence listener during lifecycle unload."""

        if self._unsubscribe:
            self._unsubscribe()
            self._unsubscribe = None

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
        mapped, _text = dump_config(config)
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

    async def get_yaml(self) -> str:
        """Return the current config-entry options as YAML."""

        _mapped, text = dump_config(await self.load())
        return text

    async def save_yaml(self, text: str) -> dict[str, Any]:
        """Validate and persist raw YAML without changing its structure."""

        document = self.validate_yaml(text)
        return self._save_options(document.model_dump(exclude_none=True))

    def validate_yaml(self, text: str) -> Configuration:
        """Validate raw YAML without reading or changing the stored document."""

        return parse_config(text)


def parse_yaml_text(text: str) -> dict[str, Any]:
    """Parse YAML text into a mapping."""

    loaded = yaml.safe_load(text)

    if loaded is None:
        loaded = {}

    if not isinstance(loaded, dict):
        raise ValueError("HA Notifications YAML must contain a mapping.")

    return loaded


def dump_yaml_text(config: dict[str, Any]) -> str:
    """Format a config mapping as YAML text."""

    return yaml.safe_dump(
        config,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    )


def parse_config(text: str) -> Configuration:
    """Parse and validate YAML into the controller's typed configuration."""

    return Configuration.model_validate(parse_yaml_text(text))


def dump_config(config: Configuration | dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Validate a configuration and format its persisted mapping as YAML."""

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
    return mapped, dump_yaml_text(mapped)


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
