"""Shared backend fixtures loaded from canonical JSON cases."""

import asyncio
import json
from collections.abc import AsyncGenerator
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
import yaml
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from homeassistant import bootstrap, config_entries, loader
from homeassistant.auth import auth_manager_from_config
from homeassistant.components.config import automation as ha_automation_config
from homeassistant.components.http import KEY_HASS
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import (
    translation,
)
from homeassistant.util import ulid as ulid_util

_ALERT_FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "alerts.json").read_text())
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

    def __init__(
        self,
        *,
        domain: str,
        title: str = "Mock Title",
        data=None,
        options=None,
        version: int = 6,
        minor_version: int = 0,
    ) -> None:
        super().__init__(
            data=data or {},
            discovery_keys={},
            domain=domain,
            entry_id=ulid_util.ulid_now(),
            minor_version=minor_version,
            options=options or {},
            source=config_entries.SOURCE_USER,
            subentries_data=(),
            title=title,
            unique_id=None,
            version=version,
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
async def automation_api(hass, monkeypatch) -> AsyncGenerator[AutomationApi]:
    """Serve HA's real automation config view to an administrator."""
    views: list[Any] = []
    with monkeypatch.context() as patch:
        patch.setattr(hass, "http", SimpleNamespace(register_view=views.append), raising=False)
        assert ha_automation_config.async_setup(hass)
    (view,) = views
    admin = await hass.auth.async_create_user("Admin", group_ids=["system-admin"])

    @web.middleware
    async def authenticate(request, handler):
        request["hass_user"] = admin
        return await handler(request)

    app = web.Application(middlewares=[authenticate])
    app[KEY_HASS] = hass

    async def handle(request: web.Request) -> web.StreamResponse:
        method = getattr(view, request.method.lower())
        return await method(request, request.match_info["config_key"])

    app.router.add_route("*", "/api/config/automation/config/{config_key}", handle)
    async with TestClient(TestServer(app)) as client:
        yield AutomationApi(hass, client)
