"""Configuration handling for HA Notifications."""

from __future__ import annotations

from typing import Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from pydantic.functional_serializers import model_serializer

ReminderInterval = int | float | str | dict[str, Any]


class NotificationConfig(BaseModel):
    """The notification shape exposed by the original editor."""

    model_config = ConfigDict(extra="allow")

    action: str | None = None
    target: dict[str, Any] = Field(default_factory=dict)
    title: str = ""
    message: str = ""
    data: dict[str, Any] = Field(default_factory=dict)

    @field_validator("action")
    @classmethod
    def validate_action(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value.count(".") != 1:
            raise ValueError("notification.action must be a domain.service")
        return value


class ConfirmationButtonConfig(BaseModel):
    """Known confirmation button fields with extension values preserved."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    label: str = ""


class ConfirmationNotificationConfig(BaseModel):
    """Known confirmation notification fields with HA payloads opaque."""

    model_config = ConfigDict(extra="allow")

    enabled: bool | None = None
    action: str | None = None
    target: dict[str, Any] | None = None
    title: str | None = None
    message: str | None = None
    data: dict[str, Any] | None = None

    @model_serializer(mode="plain")
    def serialize(self) -> dict[str, Any]:
        values = {key: getattr(self, key) for key in ("enabled", "action", "target", "title", "message", "data") if key in self.model_fields_set}
        return {**values, **(self.__pydantic_extra__ or {})}


class ReminderConfig(BaseModel):
    """Known confirmation reminder fields with extension values preserved."""

    model_config = ConfigDict(extra="allow")

    enabled: bool | None = None
    interval: ReminderInterval | None = None
    max_attempts: int | None = Field(default=None, ge=1)
    forget_after_enabled: bool = False

    @model_serializer(mode="plain")
    def serialize(self) -> dict[str, Any]:
        values = {
            key: getattr(self, key)
            for key in (
                "enabled",
                "interval",
                "max_attempts",
                "forget_after_enabled",
            )
            if key in self.model_fields_set
        }
        return {**values, **(self.__pydantic_extra__ or {})}


class ConfirmationConfig(BaseModel):
    """Preserve existing confirmation, reminder, and follow-up fields."""

    model_config = ConfigDict(extra="allow")

    enabled: bool = False
    buttons: list[ConfirmationButtonConfig] = Field(default_factory=list)
    notification: ConfirmationNotificationConfig = Field(default_factory=ConfirmationNotificationConfig)
    reminders: ReminderConfig = Field(default_factory=ReminderConfig)
    actions: list[dict[str, Any]] | dict[str, Any] = Field(default_factory=list)


class AlertConfig(BaseModel):
    """Canonical persisted configuration for one alert."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    name: str = ""
    enabled: bool = True
    description: str = ""
    icon: str = "mdi:bell-outline"
    triggers: list[dict[str, Any]] = Field(default_factory=list)
    conditions: list[dict[str, Any]] = Field(default_factory=list)
    notification: NotificationConfig
    confirmation: ConfirmationConfig | None = None
    post_send_actions: dict[str, Any] | None = None
    created_at: str | None = None
    updated_at: str | None = None

    @field_validator("triggers")
    @classmethod
    def validate_triggers(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if any(not isinstance(trigger, dict) for trigger in value):
            raise ValueError("triggers entries must be mappings")
        return value

    @field_validator("conditions")
    @classmethod
    def validate_conditions(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if any(not isinstance(condition, dict) for condition in value):
            raise ValueError("conditions entries must be mappings")
        return value


class Configuration(BaseModel):
    """Canonical persisted HA Notifications configuration."""

    model_config = ConfigDict(extra="forbid")

    version: int = Field(default=1, ge=1)
    alerts: list[AlertConfig] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_alert_ids(self) -> "Configuration":
        """Prevent duplicate IDs from producing colliding automations."""
        ids = [alert.id for alert in self.alerts]
        if len(ids) != len(set(ids)):
            raise ValueError("alert IDs must be unique")
        return self


def validate_config(config: dict[str, Any]) -> dict[str, Any]:
    """Validate and serialize without legacy normalization."""
    validated = Configuration.model_validate(config)
    return validated.model_dump(mode="python", exclude_none=True)
