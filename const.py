"""Constants for Notification Center."""

from __future__ import annotations

DOMAIN = "notification_center"

VERSION = "0.3.0"
CONFIG_VERSION = 1

SERVICE_RELOAD = "reload"
SERVICE_TEST = "test"

EVENT_NOTIFICATION_ACTION = "mobile_app_notification_action"

CONFIG_FILENAME = "notification_center.yaml"

STORAGE_VERSION = 1
STORAGE_KEY = "notification_center"

MAX_HISTORY = 500
PANEL_URL = "notification-center"
PANEL_URL_PATH = "notification_center"
PANEL_TITLE = "Notification Center"
PANEL_ICON = "mdi:bell-cog"

DEFAULT_CONFIRMATION_INTERVAL = "00:30:00"
DEFAULT_MAX_ATTEMPTS = 5