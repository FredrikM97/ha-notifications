"""Configuration handling for HA Notifications."""

from __future__ import annotations

import math
from copy import deepcopy
from typing import Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    field_validator,
    model_validator,
)

ReminderInterval = int | float | str | dict[str, Any]


def _duration_seconds(value: ReminderInterval | None) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, str):
        parts = value.split(":")
        if len(parts) == 1:
            try:
                seconds = float(parts[0])
            except ValueError:
                return None
            return seconds if math.isfinite(seconds) else None
        if len(parts) == 2:
            parts.insert(0, "0")
        if len(parts) != 3:
            return None
        try:
            hours, minutes, seconds = map(float, parts)
        except ValueError:
            return None
        duration = hours * 3600 + minutes * 60 + seconds
        return duration if math.isfinite(duration) else None
    if isinstance(value, dict):
        factors = {"days": 86400, "hours": 3600, "minutes": 60, "seconds": 1}
        duration = 0.0
        for unit, factor in factors.items():
            component = value.get(unit, 0)
            if not isinstance(component, (int, float)) or isinstance(component, bool):
                return None
            duration += component * factor
        return duration if math.isfinite(duration) else None
    return None


def _periodic_trigger(interval: ReminderInterval | None) -> dict[str, Any]:
    seconds = _duration_seconds(interval) or 43200
    if seconds >= 86400:
        return {"trigger": "time_pattern", "hours": 0, "minutes": 0, "seconds": 0}
    if seconds >= 3600:
        return {"trigger": "time_pattern", "hours": f"/{max(1, min(23, round(seconds / 3600)))}"}
    if seconds >= 60:
        return {"trigger": "time_pattern", "minutes": f"/{max(1, min(59, round(seconds / 60)))}"}
    return {"trigger": "time_pattern", "seconds": f"/{max(1, int(seconds))}"}


class NotificationOptionControl(BaseModel):
    """Delivery switches for frontend-declared native option paths."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(default=True, strict=True)
    fields: dict[str, StrictBool] = Field(default_factory=dict)


class NotificationConfig(BaseModel):
    """Canonical destination, content, and opaque native device options."""

    model_config = ConfigDict(extra="forbid")

    action: str | None = None
    target: dict[str, Any] = Field(default_factory=dict)
    title: str = ""
    message: str = ""
    use_default_tag: bool = Field(default=True, strict=True)
    options: dict[str, Any] = Field(default_factory=dict)
    option_controls: dict[
        Literal["mobile", "android", "ios"], NotificationOptionControl
    ] | None = None

    def delivery_options(self) -> dict[str, Any]:
        """Copy native options and omit only explicitly disabled paths."""
        options = deepcopy(self.options)
        for control in (self.option_controls or {}).values():
            for path, enabled in control.fields.items():
                if control.enabled and enabled:
                    continue
                segments = path.split(".")
                current = options
                ancestors: list[tuple[dict[str, Any], str]] = []
                for segment in segments[:-1]:
                    nested = current.get(segment)
                    if not isinstance(nested, dict):
                        break
                    ancestors.append((current, segment))
                    current = nested
                else:
                    if segments[-1] not in current:
                        continue
                    del current[segments[-1]]
                    for parent, segment in reversed(ancestors):
                        if current:
                            break
                        del parent[segment]
                        current = parent
        return options

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


class ConfirmationNotificationConfig(NotificationConfig):
    """Follow-up content with recipients inherited when not overridden."""

    enabled: bool = False
    target: dict[str, Any] | None = None


class ReminderConfig(BaseModel):
    """Known confirmation reminder fields with extension values preserved."""

    model_config = ConfigDict(extra="allow")

    enabled: bool = True
    interval: ReminderInterval = 1800
    max_attempts: int = Field(default=5, ge=1)
    show_attempts: bool = False
    forget_after_enabled: bool = False
    timeout: ReminderInterval = 900

    @model_validator(mode="after")
    def validate_forget_after_timeout(self) -> "ReminderConfig":
        if self.forget_after_enabled and (_duration_seconds(self.timeout) or 0) <= 0:
            raise ValueError(
                "forget_after_enabled requires a positive reminders.timeout"
            )
        return self

class ConfirmationConfig(BaseModel):
    """Preserve existing confirmation, reminder, and follow-up fields."""

    model_config = ConfigDict(extra="allow")

    enabled: bool = False
    buttons: list[ConfirmationButtonConfig] = Field(default_factory=list)
    notification: ConfirmationNotificationConfig = Field(default_factory=ConfirmationNotificationConfig)
    reminders: ReminderConfig = Field(default_factory=ReminderConfig)
    actions: list[dict[str, Any]] = Field(default_factory=list)
    actions_enabled: bool | None = Field(default=None, strict=True)


class EnabledFeature(BaseModel):
    """Common enable switch for independently controlled features."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = True


class TriggerOptions(EnabledFeature):
    """Trigger sources and their behavior, scoped to the monitor feature."""

    items: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("items")
    @classmethod
    def validate_trigger_items(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if any(not isinstance(trigger, dict) for trigger in value):
            raise ValueError("monitor.triggers.items entries must be mappings")
        return value


class IntervalConfig(BaseModel):
    """Independent enablement and native duration for scheduled evaluations."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = Field(default=False, strict=True)
    value: ReminderInterval = 43200


class ConditionOptions(EnabledFeature):
    """Condition gate and built-in startup/periodic evaluations."""

    items: list[dict[str, Any]] = Field(default_factory=list)
    startup: bool = False
    interval: IntervalConfig = Field(default_factory=IntervalConfig)

    @field_validator("items")
    @classmethod
    def validate_items(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if any(not isinstance(condition, dict) for condition in value):
            raise ValueError("monitor.conditions.items entries must be mappings")
        return value


class InactiveOptions(BaseModel):
    """Explicit native triggers that cancel pending confirmation waits."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    items: list[dict[str, Any]] = Field(default_factory=list)
    clear_notification: bool = False


class MonitorConfig(BaseModel):
    """All alert evaluation configuration, grouped by trigger and condition feature."""

    model_config = ConfigDict(extra="forbid")

    triggers: TriggerOptions = Field(default_factory=TriggerOptions)
    conditions: ConditionOptions = Field(default_factory=ConditionOptions)
    inactive: InactiveOptions = Field(default_factory=InactiveOptions)
    automation_mode: Literal["single", "restart", "queued", "parallel"] = "parallel"

    @property
    def enabled_triggers(self) -> list[dict[str, Any]]:
        """Return effective HA triggers after applying feature enablement."""
        triggers = []
        if self.conditions.enabled:
            if self.conditions.startup:
                triggers.append({"trigger": "homeassistant", "event": "start"})
            if self.conditions.interval.enabled:
                triggers.append(_periodic_trigger(self.conditions.interval.value))
        if self.triggers.enabled:
            triggers.extend(dict(trigger) for trigger in self.triggers.items)
        return triggers

class AlertConfig(BaseModel):
    """Canonical persisted configuration for one alert."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    name: str = ""
    enabled: bool = True
    description: str = ""
    icon: str = "mdi:bell-outline"
    monitor: MonitorConfig = Field(default_factory=MonitorConfig)
    notification: NotificationConfig
    confirmation: ConfirmationConfig | None = None
    post_send_actions: dict[str, Any] | None = None
    created_at: str | None = None
    updated_at: str | None = None

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
    """Validate and serialize the canonical nested configuration."""
    validated = Configuration.model_validate(config)
    return validated.model_dump(mode="python", exclude_none=True)
