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
from custom_components.ha_notifications.domain import AutomationRunTracker


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

    assert len(registered) == 8
    assert {handler._ws_command for handler in registered} == {
        "ha_notifications/get_config",
        "ha_notifications/automation_status",
        "ha_notifications/get_history",
        "ha_notifications/validate_config",
        "ha_notifications/save_config",
        "ha_notifications/delete",
        "ha_notifications/reload",
        "ha_notifications/trigger",
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
async def test_trigger_runs_generated_automation_for_alert() -> None:
    entry = SimpleNamespace(
        options={"version": 1, "alerts": [{
            "id": "door",
            "notification": {"action": "notify.mobile_app_phone"},
        }]},
        data={},
    )
    calls: list[tuple[str, str, dict[str, str], bool]] = []

    async def async_call(
        domain: str,
        service: str,
        data: dict[str, str],
        blocking: bool,
    ) -> None:
        calls.append((domain, service, data, blocking))

    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
        services=SimpleNamespace(async_call=async_call),
        states=SimpleNamespace(get=lambda entity_id: object()),
    )
    connection = SimpleNamespace(
        send_result=lambda _id, result: setattr(connection, "result", result),
        send_error=lambda *_args: pytest.fail("trigger should not fail"),
    )

    await _dispatch(
        hass,
        connection,
        {"id": 1, "alert_id": "door"},
        websocket.WebsocketDispatcher().trigger,
    )

    assert calls == [(
        "automation",
        "trigger",
        {
            "entity_id": "automation.ha_notifications_door",
            "skip_condition": False,
        },
        True,
    )]
    assert connection.result == {"triggered": True, "alert_id": "door"}


@pytest.mark.asyncio
async def test_trigger_uses_loaded_entity_id_for_generated_unique_id() -> None:
    """Use Home Assistant's restored entity ID when it differs from the YAML ID."""
    alert = {
        "id": "alert_1_2",
        "notification": {"action": "notify.mobile_app_phone"},
    }
    entry = SimpleNamespace(
        options={"version": 1, "alerts": [alert]},
        data={},
    )
    calls: list[tuple[str, str, dict[str, object], bool]] = []

    async def async_call(
        domain: str,
        service: str,
        data: dict[str, object],
        blocking: bool,
    ) -> None:
        calls.append((domain, service, data, blocking))

    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
        data={
            websocket.ha_automation.DATA_COMPONENT: SimpleNamespace(entities=[
                SimpleNamespace(
                    unique_id="ha_notifications_alert_1_2",
                    entity_id="automation.ha_notifications_alert_1_2",
                ),
            ]),
        },
        services=SimpleNamespace(async_call=async_call),
        states=SimpleNamespace(get=lambda entity_id: object()),
    )
    connection = SimpleNamespace(
        send_result=lambda _id, result: setattr(connection, "result", result),
        send_error=lambda *_args: pytest.fail("trigger should not fail"),
    )

    await _dispatch(
        hass,
        connection,
        {"id": 1, "alert_id": "alert_1_2"},
        websocket.WebsocketDispatcher().trigger,
    )

    assert calls == [(
        "automation",
        "trigger",
        {
            "entity_id": "automation.ha_notifications_alert_1_2",
            "skip_condition": False,
        },
        True,
    )]


@pytest.mark.asyncio
async def test_trigger_reconciles_missing_automation_before_running_flow(
    monkeypatch: pytest.MonkeyPatch,
    alert_factory,
) -> None:
    """Restore the generated flow instead of bypassing its configured steps."""
    alert = alert_factory("base")
    entry = SimpleNamespace(
        options={"version": 1, "alerts": [alert]},
        data={},
    )
    calls: list[tuple[str, str, dict[str, object], bool]] = []
    reconciled: list[list[dict[str, object]]] = []
    automation_loaded = False

    async def reconcile(_hass, alerts):
        nonlocal automation_loaded
        automation_loaded = True
        reconciled.append(alerts)

    monkeypatch.setattr(websocket, "async_reconcile_automations", reconcile)

    async def async_call(
        domain: str,
        service: str,
        data: dict[str, object],
        blocking: bool,
    ) -> None:
        calls.append((domain, service, data, blocking))

    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
        services=SimpleNamespace(async_call=async_call),
        states=SimpleNamespace(
            get=lambda entity_id: object() if automation_loaded else None,
        ),
    )
    connection = SimpleNamespace(
        send_result=lambda _id, result: setattr(connection, "result", result),
        send_error=lambda *_args: pytest.fail("trigger should not fail"),
    )

    await _dispatch(
        hass,
        connection,
        {"id": 1, "alert_id": "base_alert"},
        websocket.WebsocketDispatcher().trigger,
    )

    assert len(reconciled) == 1
    assert [item["id"] for item in reconciled[0]] == [alert["id"]]
    assert calls == [(
        "automation",
        "trigger",
        {
            "entity_id": "automation.ha_notifications_base_alert",
            "skip_condition": False,
        },
        True,
    )]
    assert connection.result == {"triggered": True, "alert_id": "base_alert"}


@pytest.mark.asyncio
async def test_trigger_reports_unavailable_automation_after_reconcile(
    monkeypatch: pytest.MonkeyPatch,
    alert_factory,
) -> None:
    """Do not call automation.trigger when reload did not create the entity."""
    alert = alert_factory("base")
    entry = SimpleNamespace(
        options={"version": 1, "alerts": [alert]},
        data={},
    )

    async def reconcile(_hass, _alerts):
        return []

    async def async_call(*_args, **_kwargs):
        pytest.fail("automation.trigger should not run for a missing entity")

    monkeypatch.setattr(websocket, "async_reconcile_automations", reconcile)
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
        services=SimpleNamespace(async_call=async_call),
        states=SimpleNamespace(get=lambda entity_id: None),
    )

    with pytest.raises(
        websocket.HomeAssistantError,
        match="Generated automation ha_notifications_base_alert has no available",
    ):
        await websocket.WebsocketDispatcher().trigger(
            hass,
            {"alert_id": "base_alert"},
        )


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
            "active_runs": 0,
            "active_runs_waiting": 0,
            "active_runs_running": 0,
            "active_runs_uncertain": True,
        },
        "demo": {
            "status": "missing",
            "enabled": False,
            "last_triggered": None,
            "mode": "single",
            "active_runs": 0,
            "active_runs_waiting": 0,
            "active_runs_running": 0,
            "active_runs_uncertain": True,
        },
        "notification_alert": {
            "status": "missing",
            "enabled": False,
            "last_triggered": None,
            "mode": "single",
            "active_runs": 0,
            "active_runs_waiting": 0,
            "active_runs_running": 0,
            "active_runs_uncertain": True,
        },
        "configuration_alert": {
            "status": "missing",
            "enabled": False,
            "last_triggered": None,
            "mode": "single",
            "active_runs": 0,
            "active_runs_waiting": 0,
            "active_runs_running": 0,
            "active_runs_uncertain": True,
        },
    }]

def test_automation_runtime_status_reports_parallel_runs(
    alert_factory,
) -> None:
    alert = alert_factory("base")
    alert_id = alert["id"]
    tracker = AutomationRunTracker.create()
    tracker.started(alert_id, "run-a")
    tracker.started(alert_id, "run-b")
    tracker.phase(alert_id, "run-a", "waiting")
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(automation_runs=tracker),
    )
    state = SimpleNamespace(
        state="on",
        attributes={"last_triggered": "2026-09-29T12:00:00+00:00"},
    )
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
        states=SimpleNamespace(get=lambda entity_id: state),
    )

    result = websocket._automation_runtime_status(hass, [], alert)

    assert result["active_runs"] == 2
    assert result["active_runs_waiting"] == 1
    assert result["active_runs_running"] == 1
    assert result["active_runs_uncertain"] is False
    assert result["enabled"] is True
    assert result["last_triggered"] == "2026-09-29T12:00:00+00:00"

    tracker.completed(alert_id, "run-a")
    assert tracker.status(alert_id) == {
        "active_runs": 1,
        "active_runs_waiting": 0,
        "active_runs_running": 1,
        "active_runs_uncertain": False,
    }


def test_automation_run_tracker_reports_phase_transitions(alert_factory) -> None:
    tracker = AutomationRunTracker.create()
    alert_id = alert_factory("base")["id"]

    tracker.started(alert_id, "run-1")
    assert tracker.status(alert_id)["active_runs_running"] == 1

    tracker.phase(alert_id, "run-1", "waiting")
    assert tracker.status(alert_id)["active_runs_waiting"] == 1
    assert tracker.status(alert_id)["active_runs_running"] == 0

    tracker.completed(alert_id, "run-1")
    assert tracker.status(alert_id) == {
        "active_runs": 0,
        "active_runs_waiting": 0,
        "active_runs_running": 0,
        "active_runs_uncertain": False,
    }

    tracker.started(alert_id, "run-2")
    tracker.phase(alert_id, "run-2", "waiting")
    tracker.cleared(alert_id)
    assert tracker.status(alert_id) == {
        "active_runs": 0,
        "active_runs_waiting": 0,
        "active_runs_running": 0,
        "active_runs_uncertain": False,
    }


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