"""Constants for Notification Center."""

from __future__ import annotations

DOMAIN = "notification_center"

VERSION = "0.4.0"
CONFIG_VERSION = 1

SERVICE_RELOAD = "reload"
SERVICE_TEST = "test"

EVENT_NOTIFICATION_ACTION = "mobile_app_notification_action"

CONFIG_FILENAME = "notification_center.yaml"

STORAGE_VERSION = 1
STORAGE_KEY = "notification_center"

MAX_HISTORY = 500
PANEL_TITLE = "Notification Center"
PANEL_ICON = "mdi:bell-cog"
FRONTEND_STATIC_URL = f"/{DOMAIN}_static"
FRONTEND_BUILD_DIR = "dist"
PANEL_MODULE = f"{FRONTEND_STATIC_URL}/panel.js"
FRONTEND_REGISTERED_KEY = f"{DOMAIN}_frontend_static_registered"

DEFAULT_CONFIRMATION_INTERVAL = "00:30:00"
DEFAULT_MAX_ATTEMPTS = 5