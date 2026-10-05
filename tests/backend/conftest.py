"""Shared backend fixtures loaded from canonical JSON cases."""

import asyncio
import json
from collections.abc import AsyncGenerator
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import yaml
from homeassistant import bootstrap, config_entries, loader
from homeassistant.auth import auth_manager_from_config
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import translation
from homeassistant.util import ulid as ulid_util

_ALERT_FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "alerts.json").read_text()
)
_CUSTOM_COMPONENTS = Path(__file__).resolve().parents[2] / "custom_components"


@pytest.fixture
async def hass(tmp_path: Path) -> AsyncGenerator[HomeAssistant]:
    """Run a real Home Assistant core against an isolated config directory."""
    # Production HA starts tasks eagerly; timing-sensitive tests depend on it.
    asyncio.get_running_loop().set_task_factory(asyncio.eager_task_factory)
    (tmp_path / "custom_components").symlink_to(_CUSTOM_COMPONENTS)
    hass = HomeAssistant(str(tmp_path))
    hass.config.skip_pip = True
    hass.config_entries = config_entries.ConfigEntries(hass, {})
    loader.async_setup(hass)
    # Custom integrations stay disabled unless a test requests them.
    hass.data[loader.DATA_CUSTOM_COMPONENTS] = {}
    assert await bootstrap.async_load_base_functionality(hass)
    hass.auth = await auth_manager_from_config(hass, [{"type": "homeassistant"}], [])
    await hass.auth.async_get_users()
    await translation.async_load_integrations(hass, {"homeassistant"})
    await hass.async_start()
    yield hass
    for entry in hass.config_entries.async_entries():
        if entry.state is config_entries.ConfigEntryState.LOADED:
            await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_stop(force=True)


@pytest.fixture
def enable_custom_integrations(hass: HomeAssistant) -> None:
    """Let the loader discover custom_components/ha_notifications."""
    hass.data.pop(loader.DATA_CUSTOM_COMPONENTS)


class MockConfigEntry(config_entries.ConfigEntry):
    """A config entry with test defaults that can be attached to hass."""

    def __init__(self, *, domain: str, title: str = "Mock Title", data=None, options=None) -> None:
        super().__init__(
            data=data or {},
            discovery_keys={},
            domain=domain,
            entry_id=ulid_util.ulid_now(),
            minor_version=1,
            options=options or {},
            source=config_entries.SOURCE_USER,
            subentries_data=(),
            title=title,
            unique_id=None,
            version=1,
        )

    def add_to_hass(self, hass: HomeAssistant) -> None:
        hass.config_entries._entries[self.entry_id] = self


def async_mock_service(
    hass: HomeAssistant, domain: str, service: str, raise_exception: Exception | None = None
) -> list[ServiceCall]:
    """Register a recording service and return its call log."""
    calls: list[ServiceCall] = []

    @callback
    def record(call: ServiceCall) -> None:
        calls.append(call)
        if raise_exception is not None:
            raise raise_exception

    hass.services.async_register(domain, service, record)
    return calls


def alert_fixture(name: str) -> dict[str, Any]:
    """Return a copy of a named canonical alert fixture."""
    return deepcopy(_ALERT_FIXTURES[name])


@pytest.fixture
def backend_alerts() -> dict[str, dict[str, Any]]:
    """Load reusable canonical alert fixtures."""
    return deepcopy(_ALERT_FIXTURES)


@pytest.fixture
def alert_factory():
    """Build a canonical alert with focused overrides."""

    def build_alert(name: str = "base", **overrides: Any) -> dict[str, Any]:
        alert = alert_fixture(name)
        alert.update(overrides)
        return alert

    return build_alert


@pytest.fixture
def full_feature_alert() -> dict[str, Any]:
    """Return the canonical full-feature automation case."""
    return alert_fixture("full_feature")


@pytest.fixture
def mock_automation_files(hass):
    """Prepare and inspect isolated Home Assistant automation config files."""
    configuration_path = Path(hass.config.path("configuration.yaml"))
    automation_path = Path(hass.config.path("ha_notifications_automations.yaml"))

    def prepare(*, include: bool = True) -> None:
        configuration = (
            "automation ha_notifications: !include "
            "ha_notifications_automations.yaml\n"
            if include
            else ""
        )
        configuration_path.write_text(configuration)
        automation_path.write_text("[]\n")

    def read_automations() -> list[dict[str, Any]]:
        return yaml.safe_load(automation_path.read_text())

    return {"prepare": prepare, "read_automations": read_automations}
