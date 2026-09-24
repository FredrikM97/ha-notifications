"""Feature-owned structured configuration routes."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field

from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route

if TYPE_CHECKING:
    from ..support.storage import Storage


class MonitorConfig(BaseModel):
    """Validated watcher settings for one alert."""

    model_config = ConfigDict(extra="allow")

    on_change: bool | None = None
    startup: bool | None = None
    interval: int | float | None = None
    clear_on_condition_change: bool | None = None


class Alert(BaseModel, Mapping[str, Any]):
    """The validated persisted alert document."""

    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    enabled: bool = True
    description: str = ""
    icon: str = "mdi:bell-outline"
    created_at: str | None = None
    updated_at: str | None = None
    monitor: MonitorConfig | None = None

    def __getitem__(self, key: str) -> Any:
        """Expose configured fields and preserved feature sections directly."""

        if key in self.model_fields:
            return getattr(self, key)
        try:
            return self.model_extra[key]
        except KeyError as err:
            raise KeyError(key) from err

    def __iter__(self) -> Iterator[str]:
        """Iterate over the canonical entity fields and extra sections."""

        yield from self.model_fields
        yield from self.model_extra

    def __len__(self) -> int:
        """Return the number of configured fields exposed by the entity."""

        return len(self.model_fields) + len(self.model_extra)


class Configuration(BaseModel):
    """The complete persisted configuration document."""

    model_config = ConfigDict(extra="allow")

    version: int = 1
    alerts: list[Alert] = Field(default_factory=list)


def monitor_config(alert: Mapping[str, Any] | Alert) -> MonitorConfig:
    """Return typed monitor settings from a model or serialized alert."""

    if isinstance(alert, Alert):
        return alert.monitor or MonitorConfig()
    return MonitorConfig.model_validate(alert.get("monitor") or {})


class ConfigurationFeature(FeatureBase):
    """Own structured configuration read, validation, and replacement workflows."""

    name = "configuration"

    def __init__(
        self,
        hass: Any,
        state: dict[str, Any],
        storage: Storage,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()
        self._storage = storage

    @websocket_route(
        "configuration.get_config",
        command="get_config",
        error_code="get_config_failed",
        error_message="Unable to load configuration.",
    )
    async def get_config(self) -> dict[str, Any]:
        """Return the saved document for YAML export and recovery."""

        config = await self._storage.load_raw_config()
        ordered = dict(config)
        version = ordered.pop("version", 1)
        return {"version": version, **ordered}

    @websocket_route(
        "configuration.validate_config",
        command="validate_config",
        arguments=(WebsocketArgument("config", dict),),
        error_code="validate_config_failed",
        error_message="Invalid configuration.",
    )
    async def validate_config(self, config: dict[str, Any]) -> bool:
        """Validate configuration without changing its saved document."""

        Configuration.model_validate(config)
        return True

    @websocket_route(
        "configuration.save_config",
        command="save_config",
        arguments=(WebsocketArgument("config", dict),),
        error_code="save_config_failed",
        error_message="Unable to save configuration.",
    )
    async def save_config(self, config: dict[str, Any]) -> dict[str, Any]:
        """Validate and persist the supplied configuration document."""

        Configuration.model_validate(config)
        saved = await self._storage.save_config(config)
        return {"saved": True, "config": saved}

    @websocket_route(
        "configuration.reload",
        command="reload",
        error_code="reload_failed",
        error_message="Unable to reload configuration.",
    )
    async def reload(self) -> bool:
        """Reload persisted configuration through the lifecycle owner."""

        if self.lifecycle is None:
            raise RuntimeError("Configuration feature has not been set up")
        await self.lifecycle.reload()
        return True