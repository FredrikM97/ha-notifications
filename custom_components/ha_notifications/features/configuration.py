"""Feature-owned structured configuration routes."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field

from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route

if TYPE_CHECKING:
    from ..support.storage import ConfigEntryStorage


class Alert(BaseModel):
    """The validated persisted alert document."""

    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    enabled: bool = True
    description: str = ""
    icon: str = "mdi:bell-outline"
    created_at: str | None = None
    updated_at: str | None = None


class Configuration(BaseModel):
    """The complete persisted configuration document."""

    model_config = ConfigDict(extra="allow")

    version: int = 1
    alerts: list[Alert] = Field(default_factory=list)


class AlertRuntime(BaseModel):
    """The persisted runtime record for one alert."""

    model_config = ConfigDict(extra="allow")

    active: bool = False
    acknowledged: bool = False
    attempts: int = 0
    notification_id: str | None = None
    confirmation_action_ids: dict[str, str] = Field(default_factory=dict)
    flow_id: str | None = None
    started_at: str | None = None
    last_evaluated: str | None = None
    last_notified: str | None = None
    confirmed_at: str | None = None
    confirmed_by: str | None = None
    last_error: str | None = None
    last_event: dict[str, Any] | None = None


class ConfigurationFeature(FeatureBase):
    """Own structured configuration read, validation, and replacement workflows."""

    name = "configuration"

    def __init__(
        self,
        hass: Any,
        state: dict[str, Any],
        config_storage: ConfigEntryStorage,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()
        self._config_storage = config_storage

    @websocket_route(
        "configuration.get_config",
        command="get_config",
        error_code="get_config_failed",
        error_message="Unable to load configuration.",
    )
    async def get_config(self) -> dict[str, Any]:
        """Return the current structured configuration document."""

        return await self._config_storage.load()

    @websocket_route(
        "configuration.validate_config",
        command="validate_config",
        arguments=(WebsocketArgument("config", dict),),
        error_code="validate_config_failed",
        error_message="Invalid configuration.",
    )
    async def validate_config(self, config: dict[str, Any]) -> bool:
        """Validate configuration without changing its saved document."""

        self._config_storage.validate(config)
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

        mapped = await self._config_storage.save(config)
        return {"saved": True, "config": mapped}

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