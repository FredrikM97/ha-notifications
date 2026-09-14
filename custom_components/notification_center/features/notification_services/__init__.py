"""Notification service selection and recipient resolution."""

from .mobile_app import (
    LegacyMobileAppResolution,
    resolve_legacy_mobile_app_services,
)
from .targets import (
    DeliveryType,
    GENERIC_NOTIFY_SERVICE,
    GENERIC_NOTIFY_TARGET_KEYS,
    RegistrySnapshot,
    TargetResolution,
    classify_delivery_type,
    notification_services_for_target,
    resolve_target_devices,
    resolve_user_notification_target,
    target_values,
    generic_service_target,
)

__all__ = [
    "DeliveryType",
    "GENERIC_NOTIFY_SERVICE",
    "GENERIC_NOTIFY_TARGET_KEYS",
    "LegacyMobileAppResolution",
    "RegistrySnapshot",
    "TargetResolution",
    "classify_delivery_type",
    "notification_services_for_target",
    "resolve_legacy_mobile_app_services",
    "resolve_target_devices",
    "resolve_user_notification_target",
    "generic_service_target",
    "target_values",
]
