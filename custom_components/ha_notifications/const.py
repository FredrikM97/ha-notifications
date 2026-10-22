"""Constants for HA Notifications."""

DOMAIN = "ha_notifications"
CONFIG_VERSION = 1
CONFIG_ENTRY_VERSION = 5
CONFIG_ENTRY_MINOR_VERSION = 0
AUTOMATION_LABEL = "HA Notifications"
AUTOMATION_CATEGORY = "HA Notifications"
AUTOMATION_CATEGORY_SCOPE = "automation"

SERVICE_SEND = "send"
SERVICE_CLEAR = "clear"
SERVICE_REPORT = "report"
SERVICE_COMMAND = "command"

EVENT_COMMAND = "ha_notifications_command"
COMMAND_CANCEL_RUN = "cancel_run"
COMMAND_SKIP_CONFIRMATION = "skip_confirmation"

CONF_ALERTS = "alerts"
CONF_NOTIFICATION = "notification"
