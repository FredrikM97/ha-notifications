"""Feature-owned YAML configuration routes."""

from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, create_model

from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from .configuration_registry import registered_alert_features


def _load_feature_configurations() -> None:
    """Import feature modules so their alert fields register themselves."""

    package = importlib.import_module(__package__)
    ignored = {"configuration", "configuration_registry"}
    for module in pkgutil.iter_modules(package.__path__):
        if module.name in ignored:
            continue
        module_path = module.module_finder.find_spec(module.name).origin
        if module_path is None or "register_alert_feature(" not in Path(
            module_path
        ).read_text(encoding="utf-8"):
            continue
        importlib.import_module(f"{__package__}.{module.name}")


def _build_alert_features() -> type[BaseModel]:
    """Build the flat alert feature model from registered feature fields."""

    fields: dict[str, tuple[Any, Any]] = {}
    for field_name, (model, default) in registered_alert_features().items():
        if callable(default):
            fields[field_name] = (
                list[model],
                Field(default_factory=default),
            )
        else:
            fields[field_name] = (model | None, default)
    return create_model(
        "AlertFeatures",
        __config__=ConfigDict(extra="allow"),
        **fields,
    )


_load_feature_configurations()


AlertFeatures = _build_alert_features()


class Alert(AlertFeatures):
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
        await self.lifecycle.reload()
        return {"saved": True, "config": mapped}

    @websocket_route(
        "configuration.reload",
        command="reload",
        error_code="reload_failed",
        error_message="Unable to reload configuration.",
    )
    async def reload(self) -> bool:
        """Reload persisted configuration through the lifecycle owner."""

        await self.lifecycle.reload()
        return True