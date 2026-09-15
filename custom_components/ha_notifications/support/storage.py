"""YAML and runtime-state storage owned by explicit storage classes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from homeassistant.core import HomeAssistant, callback

from ..const import EVENT_RUNTIME_PERSIST_REQUESTED
from ..features.configuration import Configuration

DEFAULT_CONFIG: dict[str, Any] = {"version": 1, "alerts": []}


class RuntimeStateStorage:
    """Own loading and persistence of the mutable runtime state document."""

    def __init__(self, hass: HomeAssistant, store: Any, state: dict[str, Any]) -> None:
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


class ConfigurationStorage:
    """Own loading and saving the integration's YAML configuration document."""

    def __init__(self, hass: HomeAssistant, filename: str) -> None:
        self._hass = hass
        self._filename = filename

    def _path(self) -> Path:
        return Path(self._hass.config.path(self._filename))

    async def load(self) -> dict[str, Any]:
        """Load and validate the persisted configuration, creating an empty file."""

        path = self._path()
        if not path.exists():
            await self._hass.async_add_executor_job(
                _write_text, path, default_config_yaml_text()
            )
            return dict(DEFAULT_CONFIG)
        text = await self._hass.async_add_executor_job(_read_text, path)
        return parse_config(text).model_dump(exclude_none=True)

    async def save(self, config: dict[str, Any]) -> dict[str, Any]:
        """Validate and persist a structured configuration document."""

        mapped, text = dump_config(config)
        await self._hass.async_add_executor_job(_write_text, self._path(), text)
        return mapped

    async def get_yaml(self) -> str:
        """Return the raw YAML document, creating an empty one when absent."""

        path = self._path()
        if not path.exists():
            await self._hass.async_add_executor_job(
                _write_text, path, default_config_yaml_text()
            )
        return await self._hass.async_add_executor_job(_read_text, path)

    async def save_yaml(self, text: str) -> dict[str, Any]:
        """Validate and persist raw YAML without changing its structure."""

        document = self.validate_yaml(text)
        mapped = document.model_dump(exclude_none=True)
        await self._hass.async_add_executor_job(
            _write_text, self._path(), dump_yaml_text(mapped)
        )
        return mapped

    def validate_yaml(self, text: str) -> Configuration:
        """Validate raw YAML without reading or changing the stored document."""

        return parse_config(text)


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


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


def default_config_yaml_text() -> str:
    """Return the YAML text for a brand-new, empty configuration."""

    return dump_yaml_text(DEFAULT_CONFIG)


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
    mapped["alerts"] = [
        alert.model_dump(exclude_none=True) for alert in document.alerts
    ]
    return mapped, dump_yaml_text(mapped)


def ensure_runtime_state_shape(raw: Any) -> dict[str, Any]:
    """Return a runtime-state mapping with the expected top-level shape."""

    state = raw if isinstance(raw, dict) else {}
    state.setdefault("alerts", {})
    state.setdefault("history", [])

    if not isinstance(state["alerts"], dict):
        state["alerts"] = {}

    if not isinstance(state["history"], list):
        state["history"] = []

    return state
