"""Notification delivery rendering, targeting, planning, and dispatch."""

from .dispatch import NotificationDispatcher
from .planning import service_data_for_notification
from .recipients import notification_registry_snapshot
from .rendering import async_render_template, remove_none, render_value
from .types import (
    LegacyMobileAppResolution,
    NotificationDeliveryPlan,
    NotificationRegistrySnapshot,
    NotificationTargetResolution,
    RenderedNotification,
)

_async_render_template = async_render_template
_notification_registry_snapshot = notification_registry_snapshot
_remove_none = remove_none
_render_value = render_value
_service_data_for_notification = service_data_for_notification

__all__ = (
    "LegacyMobileAppResolution",
    "NotificationDeliveryPlan",
    "NotificationDispatcher",
    "NotificationRegistrySnapshot",
    "NotificationTargetResolution",
    "RenderedNotification",
    "_async_render_template",
    "_notification_registry_snapshot",
    "_remove_none",
    "_render_value",
    "_service_data_for_notification",
)