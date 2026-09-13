"""Shared test helpers for the Notification Center unit tests."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types


ROOT = Path(__file__).resolve().parents[1]
INTEGRATION_ROOT = ROOT / "custom_components" / "notification_center"
PACKAGE_NAME = "custom_components.notification_center"


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
    models = load_module(f"{PACKAGE_NAME}.models", INTEGRATION_ROOT / "models.py")
    return const, models


def load_storage():
    """Load storage with minimal Home Assistant storage dependencies."""
    ensure_package()
    load_const_and_models()

    homeassistant = sys.modules.setdefault(
        "homeassistant",
        types.ModuleType("homeassistant"),
    )
    core = sys.modules.setdefault(
        "homeassistant.core",
        types.ModuleType("homeassistant.core"),
    )
    helpers = sys.modules.setdefault(
        "homeassistant.helpers",
        types.ModuleType("homeassistant.helpers"),
    )
    helpers_storage = sys.modules.setdefault(
        "homeassistant.helpers.storage",
        types.ModuleType("homeassistant.helpers.storage"),
    )

    class HomeAssistant:
        pass

    class Store:
        def __init__(self, *_args, **_kwargs):
            pass

    homeassistant.__path__ = []
    core.HomeAssistant = HomeAssistant
    helpers.__path__ = []
    helpers_storage.Store = Store

    return load_module(f"{PACKAGE_NAME}.storage", INTEGRATION_ROOT / "storage.py")


def load_notifications():
    """Load runtime helpers with minimal Home Assistant dependencies."""
    ensure_package()
    load_storage()

    homeassistant = sys.modules["homeassistant"]
    const = sys.modules.setdefault(
        "homeassistant.const",
        types.ModuleType("homeassistant.const"),
    )
    core = sys.modules["homeassistant.core"]
    helpers = sys.modules["homeassistant.helpers"]
    event = sys.modules.setdefault(
        "homeassistant.helpers.event",
        types.ModuleType("homeassistant.helpers.event"),
    )
    template = sys.modules.setdefault(
        "homeassistant.helpers.template",
        types.ModuleType("homeassistant.helpers.template"),
    )
    util = sys.modules.setdefault(
        "homeassistant.util",
        types.ModuleType("homeassistant.util"),
    )
    dt = sys.modules.setdefault(
        "homeassistant.util.dt",
        types.ModuleType("homeassistant.util.dt"),
    )

    const.EVENT_HOMEASSISTANT_STARTED = "homeassistant_started"
    core.Context = object
    core.Event = object
    core.callback = lambda function: function
    event.TrackTemplate = object
    event.TrackTemplateResult = object
    event.async_track_template_result = lambda *args: None
    event.async_track_time_interval = lambda *args: None
    template.Template = object
    template.TemplateError = Exception
    template.result_as_boolean = bool
    dt.now = lambda: None
    dt.utcnow = lambda: None
    dt.parse_datetime = lambda value: None
    helpers.__path__ = []
    util.__path__ = []
    homeassistant.__path__ = []

    return load_module(
        f"{PACKAGE_NAME}.notifications",
        INTEGRATION_ROOT / "notifications.py",
    )
