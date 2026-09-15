"""Feature-owned YAML configuration routes."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from .feature_config import AlertFeatureConfig


class Alert(AlertFeatureConfig):
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
    confirmation_action_id: str | None = None
    flow_id: str | None = None
    started_at: str | None = None
    last_evaluated: str | None = None
    last_notified: str | None = None
    confirmed_at: str | None = None
    confirmed_by: str | None = None
    last_error: str | None = None
    last_event: dict[str, Any] | None = None


class ConfigurationFeature(FeatureBase):
    """Own YAML read, validation, and replacement workflows."""

    name = "configuration"

    @websocket_route(
        "configuration.get_yaml",
        command="get_yaml",
        error_code="get_yaml_failed",
        error_message="Unable to load YAML.",
    )
    async def get_yaml(self) -> dict[str, str]:
        """Return raw YAML, creating the empty document when absent."""

        return {"yaml": await self.services.configuration_storage.get_yaml()}

    @websocket_route(
        "configuration.validate_yaml",
        command="validate_yaml",
        arguments=(WebsocketArgument("yaml", str),),
        error_code="validate_yaml_failed",
        error_message="Invalid YAML.",
    )
    async def validate_yaml(self, yaml: str) -> bool:
        """Validate YAML without changing its saved document."""

        self.services.configuration_storage.validate_yaml(yaml)
        return True

    @websocket_route(
        "configuration.save_yaml",
        command="save_yaml",
        arguments=(WebsocketArgument("yaml", str),),
        error_code="save_yaml_failed",
        error_message="Unable to save YAML.",
    )
    async def save_yaml(self, yaml: str) -> dict[str, Any]:
        """Validate, write, and reload the supplied YAML document."""

        mapped = await self.services.configuration_storage.save_yaml(yaml)
        await self.services.reload_configuration()
        return {"saved": True, "config": mapped}

    @websocket_route(
        "configuration.reload",
        command="reload",
        error_code="reload_failed",
        error_message="Unable to reload configuration.",
    )
    async def reload(self) -> bool:
        """Reload persisted configuration through the lifecycle owner."""

        await self.services.reload_configuration()
        return True