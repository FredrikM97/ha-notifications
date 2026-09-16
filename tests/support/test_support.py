"""Shared test helpers for the HA Notifications unit tests."""

from __future__ import annotations

import importlib

PACKAGE_NAME = "custom_components.ha_notifications"


def ensure_package() -> None:
    """Load the real integration package instead of injecting a fake module."""
    importlib.import_module(PACKAGE_NAME)


def load_const_and_models():
    """Import the configuration modules through the normal package path."""
    ensure_package()
    const = importlib.import_module(f"{PACKAGE_NAME}.const")
    alert = importlib.import_module(f"{PACKAGE_NAME}.features.configuration")
    return const, alert


def load_storage():
    """Import the storage module through the normal package path."""
    ensure_package()
    return importlib.import_module(f"{PACKAGE_NAME}.support.storage")
