"""Delivery planning data structures."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant


@dataclass(frozen=True)
class LegacyMobileAppResolution:
    """Verified direct Mobile App delivery candidates for selected targets."""

    device_ids: set[str]
    services: list[str]


@dataclass(frozen=True)
class NotificationTargetResolution:
    """Expanded device, area, and config-entry targets for notification delivery."""

    device_ids: set[str]
    area_ids: set[str]
    config_entry_ids: set[str]


@dataclass
class RenderedNotification:
    """Template-rendered notification values ready for delivery planning."""

    title: Any
    message: Any
    target: dict[str, Any]
    extra_data: dict[str, Any]
    action: str
    confirmation: Any
    has_user_recipients: bool


@dataclass
class NotificationDeliveryPlan:
    """Resolved services and target for a notification delivery."""

    actions_to_call: list[str]
    route: str
    target: dict[str, Any]
    legacy_resolution: LegacyMobileAppResolution
    requested_counts: dict[str, int]


@dataclass(frozen=True)
class NotificationRegistrySnapshot:
    """Home Assistant registries used while planning one notification delivery."""

    hass: HomeAssistant
    area_registry: Any
    device_registry: Any
    entity_registry: Any
    mobile_app_entries: list[Any]
    mobile_app_entry_ids: set[str]