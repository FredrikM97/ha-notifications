"""Shared backend fixtures loaded from canonical JSON cases."""

import json
from collections.abc import AsyncGenerator
from copy import deepcopy
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, create_autospec

import pytest
import yaml
from aiohttp.test_utils import TestClient
from homeassistant.components.config import automation as ha_automation_config
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant.common import MockModule, mock_integration

from custom_components import ha_notifications
from custom_components.ha_notifications.history import HistoryStore

_ALERT_FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "alerts.json").read_text())
_CUSTOM_COMPONENTS = Path(__file__).resolve().parents[2] / "custom_components"


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Give the upstream hass fixture isolated files and our custom integration."""
    (Path(hass_tmp_config_dir) / "custom_components").symlink_to(_CUSTOM_COMPONENTS)
    return hass_tmp_config_dir


@pytest.fixture
def mock_notification_dependencies(hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep manager-driven tests focused on this integration, not sidebar or push setup."""
    for domain in ("frontend", "mobile_app", "panel_custom"):
        mock_integration(hass, MockModule(domain))
    monkeypatch.setattr(ha_notifications, "async_register_panel", AsyncMock())


@pytest.fixture
def history_mock():
    """Constrain service-boundary mocks to the real history API."""
    return create_autospec(HistoryStore, instance=True, spec_set=True)


def alert_fixture(name: str) -> dict[str, Any]:
    """Return a copy of a named canonical alert fixture."""
    return deepcopy(_ALERT_FIXTURES[name])


@pytest.fixture
def backend_alerts() -> dict[str, dict[str, Any]]:
    """Load reusable canonical alert fixtures."""
    return deepcopy(_ALERT_FIXTURES)


@pytest.fixture
def option_controls_contract() -> dict[str, Any]:
    return json.loads(
        (Path(__file__).parent.parent / "contracts" / "option_controls.json").read_text()
    )


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


class AutomationApi:
    """Drive Home Assistant's real admin automation config API like the frontend."""

    def __init__(self, hass: HomeAssistant, client: TestClient) -> None:
        self._hass = hass
        self._client = client
        self._written: set[str] = set()

    def prepare(self, *, automations: list[dict[str, Any]] | None = None) -> None:
        """Seed HA's default automation storage before the component starts."""
        Path(self._hass.config.path("configuration.yaml")).write_text(
            "automation: !include automations.yaml\n"
        )
        Path(self._hass.config.path("automations.yaml")).write_text(
            yaml.safe_dump(automations or [], sort_keys=False)
        )

    def stored(self) -> list[dict[str, Any]]:
        """Inspect what HA's config API persisted."""
        return yaml.safe_load(Path(self._hass.config.path("automations.yaml")).read_text())

    async def get(self, automation_id: str) -> dict[str, Any] | None:
        response = await self._client.get(_automation_url(automation_id))
        if response.status == 404:
            return None
        assert response.status == 200, await response.text()
        return await response.json()

    async def post(self, automation: dict[str, Any]) -> None:
        response = await self._client.post(_automation_url(automation["id"]), json=automation)
        assert response.status == 200, await response.text()

    async def delete(self, automation_id: str) -> None:
        response = await self._client.delete(_automation_url(automation_id))
        assert response.status == 200, await response.text()

    async def sync(self, automations: list[dict[str, Any]]) -> None:
        """Write changed generated automations and delete ones no longer generated."""
        desired = {automation["id"]: automation for automation in automations}
        for automation in automations:
            if await self.get(automation["id"]) != automation:
                await self.post(automation)
        for automation_id in sorted(self._written - desired.keys()):
            await self.delete(automation_id)
        self._written = set(desired)
        await self._hass.async_block_till_done()

    async def sync_entry(self, entry: Any) -> None:
        await self.sync(entry.runtime_data.automations)


def _automation_url(automation_id: str) -> str:
    return f"/api/config/automation/config/{automation_id}"


@pytest.fixture
async def automation_api(hass, hass_client) -> AsyncGenerator[AutomationApi]:
    """Serve HA's real automation config view to an administrator."""
    assert await async_setup_component(hass, "http", {})
    assert ha_automation_config.async_setup(hass)
    api = AutomationApi(hass, await hass_client())
    try:
        yield api
    finally:
        await api.sync([])
