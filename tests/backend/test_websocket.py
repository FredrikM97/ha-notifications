"""Tests for the Home Assistant websocket boundary."""

import asyncio
import json
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
import voluptuous as vol
from homeassistant.core import callback
from homeassistant.exceptions import Unauthorized

from custom_components.ha_notifications.bridge import (
    BRAND_URL,
    PANEL_URL,
    async_register_panel,
    websocket,
)
from custom_components.ha_notifications.configuration import AlertConfig
from custom_components.ha_notifications.const import DOMAIN
from tests.backend.conftest import MockConfigEntry, async_mock_service


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

    routes = json.loads((Path(__file__).parents[1] / "contracts" / "routes.json").read_text())
    expected = {f"ha_notifications/{command}" for command in [*routes["commands"], "cancel_run"]}
    assert len(registered) == len(expected)
    assert {handler._ws_command for handler in registered} == expected


@pytest.mark.parametrize("configured", [False, True], ids=["no_entry", "configured"])
async def test_alert_defaults_returns_fresh_model_templates_without_persistence(
    hass,
    alert_factory,
    monkeypatch: pytest.MonkeyPatch,
    configured: bool,
) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"version": 1, "alerts": [alert_factory("base")]},
        options={"version": 1, "alerts": [alert_factory("persisted")]},
    ) if configured else None
    if entry is not None:
        entry.add_to_hass(hass)
    original_entries = list(hass.config_entries.async_entries(DOMAIN))
    original = deepcopy((dict(entry.data), dict(entry.options))) if entry is not None else None
    save = AsyncMock()
    reconcile = AsyncMock()
    storage_save = AsyncMock()
    monkeypatch.setattr("custom_components.ha_notifications.async_save_config", save)
    monkeypatch.setattr(websocket, "async_reconcile_automations", reconcile)
    monkeypatch.setattr("homeassistant.helpers.storage.Store.async_save", storage_save)
    expected = json.loads((Path(__file__).parents[1] / "contracts" / "alert_defaults.json").read_text())
    results: list[dict[str, Any]] = []
    connection = SimpleNamespace(
        send_result=lambda _id, result: results.append(result),
        send_error=lambda *_args: pytest.fail("alert defaults must not require configuration or storage"),
    )
    dispatcher = websocket.WebsocketDispatcher()

    for message_id in (1, 2):
        await dispatcher.dispatch(hass, connection, {"id": message_id}, dispatcher.alert_defaults)
    await hass.async_block_till_done()

    assert len(results) == 2
    assert results[0]["id"] != results[1]["id"]
    for result in results:
        assert result["id"].startswith("alert_")
        generated_uuid = UUID(result["id"].removeprefix("alert_"))
        assert generated_uuid.version == 4
        assert result["id"] == f"alert_{generated_uuid.hex}"
        assert AlertConfig.model_validate(result).id == result["id"]
        assert result == AlertConfig.editor_defaults(result["id"]).model_dump(exclude_none=True)
        assert {**result, "id": "alert_draft"} == expected
    results[0]["confirmation"]["buttons"][0]["label"] = "Changed"
    assert {**results[1], "id": "alert_draft"} == expected
    assert hass.config_entries.async_entries(DOMAIN) == original_entries
    if entry is not None:
        assert (entry.data, entry.options) == original
    save.assert_not_called()
    reconcile.assert_not_called()
    storage_save.assert_not_called()


async def test_registered_test_alert_route_requires_admin_and_alert_id(
    hass,
    alert_factory,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Validate route arguments and schedule only the requested alert as an admin."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={"version": 1, "alerts": [alert_factory("base"), alert_factory("persisted")]},
    )
    entry.add_to_hass(hass)
    entity_id = "automation.ha_notifications_demo"
    hass.states.async_set(entity_id, "on")
    calls = async_mock_service(hass, "automation", "trigger")
    trigger = AsyncMock(wraps=hass.services.async_call)
    monkeypatch.setattr(type(hass.services), "async_call", trigger)
    monkeypatch.setattr(websocket, "_WEBSOCKET_REGISTERED", set())
    websocket.register(hass)
    handler, schema = hass.data["websocket_api"]["ha_notifications/test_alert"]
    msg = schema({"id": 7, "type": "ha_notifications/test_alert", "alert_id": "demo"})
    result = asyncio.get_running_loop().create_future()
    admin = await hass.auth.async_create_user("Admin", group_ids=["system-admin"])
    connection = SimpleNamespace(
        user=admin,
        send_result=lambda message_id, response: result.set_result((message_id, response)),
        send_error=lambda *_args: pytest.fail("testing the saved alert must succeed"),
    )

    handler(hass, connection, msg)
    assert await asyncio.wait_for(result, 1) == (7, {"started": True})
    await hass.async_block_till_done()
    trigger.assert_awaited_once_with(
        "automation", "trigger",
        {"entity_id": entity_id, "skip_condition": True},
        blocking=False,
    )
    assert [dict(call.data) for call in calls] == [{
        "entity_id": entity_id, "skip_condition": True,
    }]

    for user in (None, await hass.auth.async_create_user("Non-admin")):
        connection.user = user
        with pytest.raises(Unauthorized):
            handler(hass, connection, msg)
    assert trigger.await_count == 1
    for arguments in ({}, {"alert_id": 5}, {"alert_id": ["demo"]}):
        with pytest.raises(vol.Invalid):
            schema({"id": 7, "type": "ha_notifications/test_alert", **arguments})
    routes = json.loads((Path(__file__).parents[1] / "contracts" / "routes.json").read_text())
    assert "test_alert" in routes["commands"]


@pytest.mark.parametrize(
    ("scenario", "error"),
    [
        ("no_entry", "HA Notifications has no config entry"),
        ("unknown_alert", "unknown alert_id: missing"),
        ("missing_state", "Save an alert with enabled triggers before testing it"),
    ],
)
async def test_test_alert_errors_do_not_trigger_automation(
    hass,
    alert_factory,
    scenario: str,
    error: str,
) -> None:
    """Return websocket errors rather than start a missing alert or automation."""
    if scenario != "no_entry":
        entry = MockConfigEntry(
            domain=DOMAIN,
            data={"version": 1, "alerts": [alert_factory("base")]},
        )
        entry.add_to_hass(hass)
    calls = async_mock_service(hass, "automation", "trigger")
    errors: list[tuple[object, ...]] = []
    connection = SimpleNamespace(
        send_result=lambda *_args: pytest.fail("testing a missing alert must fail"),
        send_error=lambda *args: errors.append(args),
    )
    dispatcher = websocket.WebsocketDispatcher()
    await dispatcher.dispatch(
        hass, connection,
        {"id": 9, "alert_id": "missing" if scenario == "unknown_alert" else "base_alert"},
        dispatcher.test_alert,
    )
    await hass.async_block_till_done()
    assert errors == [(9, websocket.ERROR_CODE, error)]
    assert calls == []


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
    monkeypatch.setattr(bridge, "_PANEL_REGISTERED", set())
    static_paths: list[object] = []
    panels: list[dict[str, object]] = []

    class Http:
        async def async_register_static_paths(self, configs: list[object]) -> None:
            static_paths.extend(configs)

    class Hass:
        data: dict[str, object] = {}
        http = Http()

        async def async_add_executor_job(self, function):
            return function()

    async def register_panel(hass: object, **kwargs: object) -> None:
        panels.append(kwargs)

    monkeypatch.setattr(bridge.panel_custom, "async_register_panel", register_panel)

    first_hass = Hass()
    await async_register_panel(first_hass)

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
            "module_url": f"{PANEL_URL}?v={sha256(b'custom panel').hexdigest()[:16]}",
            "require_admin": True,
        }
    ]
    panel_path.write_text("updated panel")
    second_hass = Hass()
    await async_register_panel(second_hass)
    assert panels[-1]["module_url"] == f"{PANEL_URL}?v={sha256(b'updated panel').hexdigest()[:16]}"
    assert panels[-1]["module_url"] != panels[0]["module_url"]


@pytest.mark.asyncio
async def test_get_config_returns_invalid_persisted_document_for_repair() -> None:
    persisted = {
        "version": 1,
        "alerts": [{"id": "door", "triggers": []}],
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
        alert_factory("base", id="inactive_notification_alert"),
        alert_factory("base", id="history_waiting_alert"),
        alert_factory("configuration"),
    ]
    async def history_entries(alert_id=None):
        return [
            {
                "config": {"id": "base_alert"},
                "event": {"type": "notification_sent"},
            },
            {
                "config": {"id": "demo"},
                "event": {"type": "inactive"},
            },
            {
                "config": {"id": "demo"},
                "event": {"type": "notification_cleared"},
            },
            {
                "config": {"id": "demo"},
                "event": {"type": "notification_sent"},
            },
            {
                "config": {"id": "notification_alert"},
                "event": {"type": "automation_completed"},
            },
            {
                "config": {"id": "notification_alert"},
                "event": {
                    "type": "waiting",
                    "flow_id": "confirmation-run",
                },
            },
            {
                "config": {"id": "notification_alert"},
                "event": {"type": "notification_sent"},
            },
            {
                "config": {"id": "history_waiting_alert"},
                "event": {"type": "waiting", "flow_id": "stale-run"},
            },
            {
                "config": {"id": "inactive_notification_alert"},
                "event": {"type": "inactive"},
            },
            {
                "config": {"id": "inactive_notification_alert"},
                "event": {"type": "notification_sent"},
            },
        ]

    entry = SimpleNamespace(
        options={"version": 1, "alerts": alerts},
        data={},
        runtime_data=SimpleNamespace(
            history=SimpleNamespace(async_entries=history_entries),
        ),
    )
    live_run_state = SimpleNamespace(
        state="on",
        attributes={"current": 1},
    )
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(async_entries=lambda domain: [entry]),
        states=SimpleNamespace(
            get=lambda entity_id: (
                live_run_state
                if entity_id == "automation.ha_notifications_notification_alert"
                else None
            ),
        ),
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
            "mode": "single",
            "current": 0,
            "running": False,
            "triggered": True,
            "notification_active": True,
        },
        "demo": {
            "status": "missing",
            "enabled": False,
            "mode": "single",
            "current": 0,
            "running": False,
            "triggered": False,
            "notification_active": False,
        },
        "notification_alert": {
            "status": "missing",
            "enabled": True,
            "mode": "single",
            "current": 1,
            "running": True,
            "triggered": True,
            "notification_active": True,
        },
        "inactive_notification_alert": {
            "status": "missing",
            "enabled": False,
            "mode": "single",
            "current": 0,
            "running": False,
            "triggered": False,
            "notification_active": False,
        },
        "history_waiting_alert": {
            "status": "missing",
            "enabled": False,
            "mode": "single",
            "current": 0,
            "running": False,
            "notification_active": False,
        },
        "configuration_alert": {
            "status": "missing",
            "enabled": False,
            "mode": "single",
            "current": 0,
            "running": False,
            "notification_active": False,
        },
    }]

@pytest.mark.parametrize(
    ("mode", "expected"),
    [("restart", False), ("parallel", True)],
)
def test_running_activity_respects_automation_mode(
    mode: str,
    expected: bool,
) -> None:
    entries = [
        {
            "config": {"id": "door"},
            "event": {"type": "inactive", "flow_id": "new-run"},
        },
        {
            "config": {"id": "door"},
            "event": {"type": "waiting", "flow_id": "cancelled-run"},
        },
    ]

    assert websocket._running_activity(entries, {"door": mode}) == {
        "door": expected,
    }


def test_cancelled_history_is_terminal_for_running_activity() -> None:
    entries = [
        {
            "config": {"id": "door"},
            "event": {"type": "cancelled", "flow_id": "run-1"},
        },
        {
            "config": {"id": "door"},
            "event": {"type": "waiting", "flow_id": "run-1"},
        },
    ]

    assert websocket._running_activity(entries, {"door": "parallel"}) == {
        "door": False,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(("enabled", "should_reenable"), [(True, True), (False, False)])
async def test_cancel_run_stops_actions_and_preserves_enabled_alert(
    hass,
    alert_factory,
    enabled: bool,
    should_reenable: bool,
) -> None:
    from custom_components.ha_notifications.const import (
        COMMAND_CANCEL_RUN,
        DOMAIN,
        EVENT_COMMAND,
    )
    from custom_components.ha_notifications.history import HistoryStore
    from tests.backend.conftest import MockConfigEntry, async_mock_service

    alert = alert_factory("base", id="door", enabled=enabled)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    history = HistoryStore(hass)
    entry.runtime_data = SimpleNamespace(history=history, automations=[])
    await history.async_record(
        "door", "Door", "waiting", "Waiting for confirmation", flow_id="run-1"
    )
    command_events = []
    hass.bus.async_listen(EVENT_COMMAND, callback(lambda event: command_events.append(event)))

    async def record_wait_cancellation(event) -> None:
        if event.data.get("command") == COMMAND_CANCEL_RUN:
            await history.async_record(
                "door",
                "Door",
                "cancelled",
                "Automation run cancelled",
                flow_id="run-1",
            )

    hass.bus.async_listen(EVENT_COMMAND, record_wait_cancellation)
    turn_off = async_mock_service(hass, "automation", "turn_off")
    turn_on = async_mock_service(hass, "automation", "turn_on")

    result = await websocket.WebsocketDispatcher().cancel_run(
        hass,
        {"alert_id": "door"},
    )
    await hass.async_block_till_done()

    assert result == {"cancelled": True}
    assert [event.data for event in command_events] == [{
        "alert_id": "door",
        "command": COMMAND_CANCEL_RUN,
    }]
    assert turn_off[0].data == {
        "entity_id": "automation.ha_notifications_door",
        "stop_actions": True,
    }
    if should_reenable:
        assert turn_on[0].data == {"entity_id": "automation.ha_notifications_door"}
    else:
        assert turn_on == []
    assert history._entries[0]["event"]["type"] == "cancelled"
    assert history._entries[0]["event"]["flow_id"] == "run-1"
    assert sum(
        item["event"]["type"] == "cancelled"
        for item in history._entries
        if item["event"].get("flow_id") == "run-1"
    ) == 1
    assert websocket._running_activity(
        await history.async_entries("door"),
        {"door": "restart"},
    ) == {"door": False}


def test_automation_runtime_status_reports_native_current_runs(
    alert_factory,
) -> None:
    alert = alert_factory("base")
    state = SimpleNamespace(
        state="on",
        attributes={
            "current": 2,
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
    assert "last_triggered" not in result


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