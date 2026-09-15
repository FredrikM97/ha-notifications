"""Constants for HA Notifications."""

from __future__ import annotations

from enum import StrEnum

DOMAIN = "notification_center"

VERSION = "0.4.1"
CONFIG_VERSION = 1

SERVICE_RELOAD = "reload"
SERVICE_TEST = "test"

EVENT_NOTIFICATION_ACTION = "mobile_app_notification_action"
EVENT_RUNTIME_PERSIST_REQUESTED = f"{DOMAIN}_runtime_persist_requested"

CONFIG_FILENAME = "notification_center.yaml"

STORAGE_VERSION = 1
STORAGE_KEY = "notification_center"

MAX_HISTORY = 500
PANEL_TITLE = "HA Notifications"
PANEL_ICON = "mdi:bell-cog"
CONF_SHOW_SIDEBAR = "show_sidebar"
FRONTEND_STATIC_URL = f"/{DOMAIN}_static"
FRONTEND_BUILD_DIR = "dist"
PANEL_MODULE = f"{FRONTEND_STATIC_URL}/panel.js"
FRONTEND_REGISTERED_KEY = f"{DOMAIN}_frontend_static_registered"
FRONTEND_MODULE_REGISTERED_KEY = f"{DOMAIN}_frontend_module_registered"

DEFAULT_CONFIRMATION_INTERVAL = "00:30:00"


class HistoryEventType(StrEnum):
    """Event types recorded to alert history.

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


class TransitionKind(StrEnum):
    """What happened to one alert's condition (`features/triggering.py`'s
    `TriggerTransition.kind`), used only internally by that module to pick
    which fact events to emit.
    """

    NO_CHANGE = "no_change"
    CONDITION_ERROR = "condition_error"
    BECAME_ACTIVE = "became_active"
    BECAME_INACTIVE = "became_inactive"
    SHOULD_SEND = "should_send"


class ConditionType(StrEnum):
    """Visual/template condition discriminator (`features/conditions.py`,
    `controller/alert.py`).
    """

    TEMPLATE = "template"
    STATE = "state"
    NUMERIC = "numeric"
    ATTRIBUTE = "attribute"

DEFAULT_MAX_ATTEMPTS = 5