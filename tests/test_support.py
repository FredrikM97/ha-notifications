"""Shared test helpers for the HA Notifications unit tests."""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION_ROOT = ROOT / "custom_components" / "ha_notifications"
PACKAGE_NAME = "custom_components.ha_notifications"


def ensure_package() -> None:
    """Make the integration importable without a Home Assistant install."""
    custom_components = sys.modules.setdefault(
        "custom_components",
        types.ModuleType("custom_components"),
    )
    custom_components.__path__ = [str(ROOT.parent)]

    package = sys.modules.setdefault(
        PACKAGE_NAME,
        types.ModuleType(PACKAGE_NAME),
    )
    package.__path__ = [str(INTEGRATION_ROOT)]


def load_module(module_name: str, file_path: Path):
    """Load one integration module without executing package setup."""
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load {module_name}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def load_const_and_models():
    """Load the pure configuration modules once for the test process."""
    ensure_package()
    const = load_module(f"{PACKAGE_NAME}.const", INTEGRATION_ROOT / "const.py")
    alert = load_module(
        f"{PACKAGE_NAME}.features.configuration",
        INTEGRATION_ROOT / "features" / "configuration.py",
    )
    return const, alert


def load_storage():
    """Load the pure storage module (no Home Assistant dependency needed)."""
    ensure_package()
    return load_module(
        f"{PACKAGE_NAME}.support.storage", INTEGRATION_ROOT / "support" / "storage.py"
    )
