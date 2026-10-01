"""Tests for the Home Assistant websocket boundary."""

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from custom_components.ha_notifications.bridge import (
    BRAND_URL,
    PANEL_URL,
    async_register_panel,
    websocket,
)


async def _dispatch(
    hass: Any,
    connection: Any,
    msg: dict[str, Any],
    handler: Any,
) -> None:
    await websocket.WebsocketDispatcher().dispatch(hass, connection, msg, handler)


def test_registers_only_supported_namespaced_commands(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registered: list[object] = []

    monkeypatch.setattr(
        websocket.websocket_api,
        "async_register_command",
        lambda hass, handler: registered.append(handler),
    )

    hass = SimpleNamespace(data={})
    websocket.register(hass)
    websocket.register(hass)

    assert len(registered) == 7
    assert {handler._ws_command for handler in registered} == {
        "ha_notifications/get_config",
        "ha_notifications/automation_status",
        "ha_notifications/get_history",
        "ha_notifications/validate_config",
        "ha_notifications/save_config",
        "ha_notifications/delete",
        "ha_notifications/reload",
    }


@pytest.mark.asyncio
async def test_get_history_returns_persisted_entries() -> None:
    entry = SimpleNamespace(options={"version": 1, "alerts": []}, data={})
    history = SimpleNamespace(
        async_entries=None,
    )

    async def entries(alert_id=None):
        return [{"config": {"id": alert_id or "door"}}]

    history.async_entries = entries
    entry.runtime_data = SimpleNamespace(history=history)
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
    )
    results: list[object] = []
    connection = SimpleNamespace(
        send_result=lambda _id, result: results.append(result),
        send_error=lambda *_args: pytest.fail("get_history should not fail"),
    )

    await _dispatch(
        hass,
        connection,
        {"id": 1, "alert_id": "door"},
        websocket.WebsocketDispatcher().get_history,
    )

    assert results == [[{"config": {"id": "door"}}]]


def test_config_resolution_prefers_options_over_runtime_cache() -> None:
    entry = SimpleNamespace(
        options={"version": 1, "alerts": []},
        data={"version": 1, "alerts": [{"id": "stale"}]},
        runtime_data=SimpleNamespace(config={"version": 1, "alerts": []}),
    )
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(
            async_entries=lambda domain: [entry],
        )
    )

    assert websocket._config_for(hass) == {"version": 1, "alerts": []}


@pytest.mark.asyncio
async def test_automation_document_returns_empty_for_missing_file(
    tmp_path: Path,
) -> None:
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: []),
        config=SimpleNamespace(path=lambda name: str(tmp_path / name)),
    )

    async def add_executor_job(function, *args):
        return function(*args)

    hass.async_add_executor_job = add_executor_job

    assert await websocket._automation_document(hass) == []


@pytest.mark.asyncio
async def test_async_register_panel_registers_packaged_static_asset(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    panel_path = tmp_path / "frontend" / "panel.js"
    panel_path.parent.mkdir()
    panel_path.write_text("custom panel")
    brand_path = tmp_path / "brand"
    brand_path.mkdir()
    (brand_path / "icon.png").write_bytes(b"icon")

    import custom_components.ha_notifications.bridge as bridge

    monkeypatch.setattr(bridge, "__file__", str(tmp_path / "bridge" / "__init__.py"))
    static_paths: list[object] = []
    panels: list[dict[str, object]] = []

    class Http:
        async def async_register_static_paths(self, configs: list[object]) -> None:
            static_paths.extend(configs)

    class Hass:
        data: dict[str, object] = {}
        http = Http()

    async def register_panel(hass: object, **kwargs: object) -> None:
        panels.append(kwargs)

    monkeypatch.setattr(bridge.panel_custom, "async_register_panel", register_panel)

    await async_register_panel(Hass())

    assert len(static_paths) == 2
    assert static_paths[0].url_path == PANEL_URL
    assert static_paths[0].path == str(panel_path)
    assert static_paths[1].url_path == BRAND_URL
    assert static_paths[1].path == str(brand_path)
    assert panels == [
        {
            "webcomponent_name": "ha-notifications-panel",
            "sidebar_title": "HA Notifications",
            "sidebar_icon": "mdi:bell-outline",
            "frontend_url_path": "ha_notifications",
            "module_url": PANEL_URL,
            "require_admin": True,
        }
    ]


@pytest.mark.asyncio
async def test_get_config_returns_invalid_persisted_document_for_repair() -> None:
    persisted = {
        "version": 1,
        "alerts": [{"id": "door", "monitor": {"clear_on_condition_change": True}}],
    }
    entry = SimpleNamespace(options=persisted, data={})
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
    )
    connection = SimpleNamespace(
        send_result=lambda _id, result: setattr(connection, "result", result),
        send_error=lambda *_args: pytest.fail(
            "get_config should not validate persisted data"
        ),
    )

    await _dispatch(
        hass,
        connection,
        {"id": 1},
        websocket.WebsocketDispatcher().get_config,
    )

    assert connection.result == persisted


@pytest.mark.asyncio
async def test_automation_status_projects_generated_automation_ownership(
    tmp_path: Path,
    alert_factory,
) -> None:
    """Report managed, disabled, conflicting, and missing automation states."""
    alerts = [
        alert_factory("base"),
        alert_factory("persisted"),
        alert_factory("notification"),
        alert_factory("configuration"),
    ]
    entry = SimpleNamespace(
        options={"version": 1, "alerts": alerts},
        data={},
    )
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
        states=SimpleNamespace(get=lambda entity_id: None),
    )

    async def add_executor_job(function, *args):
        return function(*args)

    hass.async_add_executor_job = add_executor_job
    results: list[dict[str, object]] = []
    connection = SimpleNamespace(
        send_result=lambda _id, result: results.append(result),
        send_error=lambda *_args: None,
    )

    await _dispatch(
        hass,
        connection,
        {"id": 1},
        websocket.WebsocketDispatcher().automation_status,
    )

    assert results == [{
        "base_alert": {
            "status": "missing",
            "enabled": False,
            "last_triggered": None,
            "mode": "single",
            "current": 0,
        },
        "demo": {
            "status": "missing",
            "enabled": False,
            "last_triggered": None,
            "mode": "single",
            "current": 0,
        },
        "notification_alert": {
            "status": "missing",
            "enabled": False,
            "last_triggered": None,
            "mode": "single",
            "current": 0,
        },
        "configuration_alert": {
            "status": "missing",
            "enabled": False,
            "last_triggered": None,
            "mode": "single",
            "current": 0,
        },
    }]

def test_automation_runtime_status_reports_native_current_runs(
    alert_factory,
) -> None:
    alert = alert_factory("base")
    state = SimpleNamespace(
        state="on",
        attributes={
            "current": 2,
            "last_triggered": "2026-09-29T12:00:00+00:00",
        },
    )
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: []),
        states=SimpleNamespace(get=lambda entity_id: state),
    )

    result = websocket._automation_runtime_status(hass, [], alert)

    assert result["current"] == 2
    assert "automation_id" not in result
    assert result["enabled"] is True
    assert result["last_triggered"] == "2026-09-29T12:00:00+00:00"


def test_automation_runtime_status_reports_missing_loaded_entity(
    alert_factory,
) -> None:
    alert = alert_factory("base")
    entry = SimpleNamespace(runtime_data=SimpleNamespace())
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
        states=SimpleNamespace(get=lambda entity_id: None),
    )

    result = websocket._automation_runtime_status(
        hass,
        [{
            "id": "ha_notifications_base_alert",
            "description": "Generated by HA Notifications. Do not edit manually.",
        }],
        alert,
    )

    assert result["status"] == "missing"
    assert result["automation_id"] == "ha_notifications_base_alert"

@pytest.mark.asyncio
async def test_save_config_returns_frontend_response_envelope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved = {"version": 1, "alerts": []}
    entry = SimpleNamespace(options=saved, data=saved)
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
    )
    connection = SimpleNamespace(
        send_result=lambda _id, result: setattr(connection, "result", result),
        send_error=lambda *_args: pytest.fail("save_config should not fail"),
    )

    async def save_config(_hass, _entry, config):
        assert config == saved
        return saved

    monkeypatch.setattr(
        "custom_components.ha_notifications.async_save_config",
        save_config,
    )

    await _dispatch(
        hass,
        connection,
        {"id": 1, "config": saved},
        websocket.WebsocketDispatcher().save_config,
    )

    assert connection.result == {"saved": True, "config": saved}