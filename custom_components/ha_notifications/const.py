"""Constants for HA Notifications."""

from __future__ import annotations

from enum import StrEnum
from typing import Any, TypedDict

DOMAIN = "ha_notifications"

VERSION = "0.4.1"
CONFIG_VERSION = 1

SERVICE_RELOAD = "reload"
SERVICE_TEST = "test"

EVENT_NOTIFICATION_ACTION = "mobile_app_notification_action"
EVENT_ALERT_EVENT = "ha_notifications_alert_event"
STATE_RUNTIME = "runtime"
STATE_HISTORY = "history"
STATE_HISTORY_RETENTION_BY_ALERT = "history_retention_by_alert"


class StateRoot(TypedDict):
    """Persisted runtime and history state shared by feature workflows."""

    runtime: dict[str, dict[str, Any]]
    history: list[dict[str, Any]]

STORAGE_VERSION = 1
STORAGE_KEY = "ha_notifications"

MAX_HISTORY = 500
PANEL_TITLE = "HA Notifications"
PANEL_ICON = "mdi:bell-cog"
CONF_SHOW_SIDEBAR = "show_sidebar"
FRONTEND_STATIC_URL = f"/{DOMAIN}_static"
FRONTEND_BUILD_DIR = "dist"
PANEL_MODULE = f"{FRONTEND_STATIC_URL}/panel.js"
FRONTEND_REGISTERED_KEY = f"{DOMAIN}_frontend_static_registered"
FRONTEND_MODULE_REGISTERED_KEY = f"{DOMAIN}_frontend_module_registered"

DEFAULT_HISTORY_RETENTION_DAYS = 30


class AlertEventType(StrEnum):
    """Event types published for one alert workflow fact.

    A `StrEnum` so existing string comparisons, JSON/YAML serialization, and
    frontend payloads keep working unchanged while call sites get typo-safe
    autocomplete instead of hand-typed string literals.
    """

    CONDITION_ACTIVE = "condition_active"
    CONDITION_INACTIVE = "condition_inactive"
    CONDITION_ERROR = "condition_error"
    NOTIFICATION_SENT = "notification_sent"
    NOTIFICATION_FAILED = "notification_failed"
    CONFIRMED = "confirmed"
    COMPLETION_SENT = "completion_sent"
    COMPLETION_FAILED = "completion_failed"
    NOTIFICATION_ACTION = "notification_action"
    NOTIFICATION_ACTION_FAILED = "notification_action_failed"
    CONFIRMATION_ACTION = "confirmation_action"
    CONFIRMATION_ACTION_FAILED = "confirmation_action_failed"
    TEST = "test"


class ConditionType(StrEnum):
    """Visual/template condition discriminator.

    See `custom_components/ha_notifications/features/conditions.py`.
    """

    TEMPLATE = "template"
    STATE = "state"
    NUMERIC = "numeric"
    ATTRIBUTE = "attribute"

DEFAULT_MAX_ATTEMPTS = 5