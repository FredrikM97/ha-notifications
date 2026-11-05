"""Tests for the Home Assistant websocket boundary."""

import json
import re
from pathlib import Path
from weakref import WeakSet

import pytest
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant.common import MockConfigEntry, async_mock_service
from syrupy.matchers import path_type

from custom_components.ha_notifications import RuntimeData
from custom_components.ha_notifications.automation import generate_automation
from custom_components.ha_notifications.automation_runtime import (
    active_flow_ids,
    automation_runtime_status,
)
from custom_components.ha_notifications.bridge import (
    BRAND_URL,
    PANEL_URL,
    async_register_panel,
    websocket,
)
from custom_components.ha_notifications.const import (
    CONFIG_ENTRY_MINOR_VERSION,
    CONFIG_ENTRY_VERSION,
    DOMAIN,
)
from custom_components.ha_notifications.history import HistoryStore

_HISTORY_MATCHER = path_type(
    {r".*\.event\.event_id": (str,)},
    regex=True,
    replacer=lambda data, match: "<event-id>",
)


@pytest.fixture
def registered_websocket_api(hass, hass_ws_client):
    websocket.register(hass)
    return hass_ws_client


async def test_websocket_requires_authentication(hass, hass_client_no_auth) -> None:
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "websocket_api", {})
    websocket.register(hass)
    client = await hass_client_no_auth()
    connection = await client.ws_connect("/api/websocket")
    assert (await connection.receive_json())["type"] == "auth_required"
    await connection.close()
    await client.close()
    assert not hass.config_entries.async_entries(DOMAIN)


async def test_websocket_allows_owner(
    hass, hass_owner_user, registered_websocket_api, snapshot
) -> None:
    token = await hass.auth.async_create_refresh_token(
        hass_owner_user, client_id="https://ha-notifications.test"
    )
    client = await registered_websocket_api(access_token=hass.auth.async_create_access_token(token))
    await client.send_json({"id": 1, "type": "ha_notifications/get_config"})
    assert await client.receive_json() == snapshot


async def test_websocket_save_validate_and_delete_round_trip(
    hass, alert_factory, registered_websocket_api, mock_notification_dependencies, snapshot
) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        options={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    client = await registered_websocket_api()
    alert = alert_factory("base")

    await client.send_json({"id": 1, "type": "ha_notifications/validate_config", "alert": alert})
    validated = await client.receive_json()
    assert entry.options == {"version": 1, "alerts": []}

    await client.send_json({"id": 2, "type": "ha_notifications/save_config", "alert": alert})
    saved = await client.receive_json()
    assert dict(entry.options) == validated["result"]
    assert entry.runtime_data.config == validated["result"]
    assert saved["result"]["config"] == validated["result"]

    await client.send_json({"id": 3, "type": "ha_notifications/get_config"})
    fetched = await client.receive_json()
    assert fetched["result"] == dict(entry.options)

    await client.send_json({"id": 4, "type": "ha_notifications/delete", "alert_id": alert["id"]})
    deleted = await client.receive_json()
    assert dict(entry.options) == {"version": 1, "alerts": []}
    assert entry.runtime_data.config == deleted["result"]["config"]
    assert dict(entry.options) == deleted["result"]["config"]
    assert entry.runtime_data.automations == []
    assert {
        "validated": validated,
        "saved": saved,
        "fetched": fetched,
        "deleted": deleted,
    } == snapshot


def test_registers_only_supported_namespaced_commands(
    hass,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registered: list[object] = []

    monkeypatch.setattr(
        websocket.websocket_api,
        "async_register_command",
        lambda hass, handler: registered.append(handler),
    )

    websocket.register(hass)
    websocket.register(hass)

    routes = json.loads((Path(__file__).parents[1] / "contracts" / "routes.json").read_text())
    expected = {f"ha_notifications/{command}" for command in [*routes["commands"], "cancel_run"]}
    assert len(registered) == len(expected)
    assert {handler._ws_command for handler in registered} == expected
    assert "ha_notifications/alert_defaults" not in expected


async def test_websocket_registration_tracks_instances_with_weak_references(
    hass, monkeypatch: pytest.MonkeyPatch
) -> None:
    registrations = []
    monkeypatch.setattr(
        websocket.websocket_api,
        "async_register_command",
        lambda _hass, handler: registrations.append(handler),
    )
    other_hass = HomeAssistant(hass.config.config_dir)
    websocket.register(other_hass)
    first_count = len(registrations)
    assert first_count > 0
    websocket.register(other_hass)
    assert len(registrations) == first_count
    assert other_hass in websocket._WEBSOCKET_REGISTERED
    assert isinstance(websocket._WEBSOCKET_REGISTERED, WeakSet)
    websocket.register(hass)
    assert len(registrations) == first_count * 2


async def test_registered_test_alert_route_requires_admin_and_alert_id(
    hass,
    alert_factory,
    registered_websocket_api,
    snapshot,
) -> None:
    """Validate route arguments and schedule only the requested alert as an admin."""
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        options={"version": 1, "alerts": [alert_factory("base"), alert_factory("persisted")]},
    )
    entry.add_to_hass(hass)
    entity_id = "automation.ha_notifications_demo"
    hass.states.async_set(entity_id, "on")
    calls = async_mock_service(hass, "automation", "trigger")
    client = await registered_websocket_api()
    await client.send_json({"id": 7, "type": "ha_notifications/test_alert", "alert_id": "demo"})
    started = await client.receive_json()
    await hass.async_block_till_done()

    errors = []
    for message_id, arguments in enumerate(({}, {"alert_id": 5}, {"alert_id": ["demo"]}), 8):
        await client.send_json(
            {"id": message_id, "type": "ha_notifications/test_alert", **arguments}
        )
        response = await client.receive_json()
        assert response["error"]["code"] == "invalid_format"
        errors.append(response)
    assert len(calls) == 1
    assert {
        "started": started,
        "calls": [dict(call.data) for call in calls],
        "invalid_arguments": errors,
    } == snapshot


async def test_registered_websocket_routes_require_admin(
    hass,
    registered_websocket_api,
    hass_read_only_access_token,
    snapshot,
) -> None:
    """Protect every registered command at the websocket boundary."""
    client = await registered_websocket_api(access_token=hass_read_only_access_token)
    route_arguments = {
        "get_config": {},
        "mobile_platforms": {"target": {}},
        "automation_status": {},
        "get_automations": {},
        "get_history": {},
        "cancel_run": {"alert_id": "door"},
        "test_alert": {"alert_id": "door"},
        "validate_config": {"config": {}},
        "save_config": {"config": {}},
        "delete": {"alert_id": "door"},
    }
    routes = json.loads((Path(__file__).parents[1] / "contracts" / "routes.json").read_text())
    assert set(route_arguments) == {*routes["commands"], "cancel_run"}

    responses = {}
    for message_id, (command, arguments) in enumerate(route_arguments.items(), 1):
        message = {
            "id": message_id,
            "type": f"ha_notifications/{command}",
            **arguments,
        }
        await client.send_json(message)
        response = await client.receive_json()
        assert response["error"]["code"] == "unauthorized", command
        responses[command] = response
    assert not hass.config_entries.async_entries(DOMAIN)
    assert responses == snapshot


@pytest.mark.parametrize(
    "scenario",
    ["no_entry", "unknown_alert", "missing_state"],
)
async def test_test_alert_errors_do_not_trigger_automation(
    hass,
    alert_factory,
    scenario: str,
    registered_websocket_api,
    snapshot,
) -> None:
    """Return websocket errors rather than start a missing alert or automation."""
    if scenario != "no_entry":
        entry = MockConfigEntry(
            version=CONFIG_ENTRY_VERSION,
            minor_version=CONFIG_ENTRY_MINOR_VERSION,
            domain=DOMAIN,
            options={"version": 1, "alerts": [alert_factory("base")]},
        )
        entry.add_to_hass(hass)
    calls = async_mock_service(hass, "automation", "trigger")
    client = await registered_websocket_api()
    await client.send_json(
        {
            "id": 9,
            "type": "ha_notifications/test_alert",
            "alert_id": "missing" if scenario == "unknown_alert" else "base_alert",
        }
    )
    assert await client.receive_json() == snapshot
    await hass.async_block_till_done()
    assert calls == []


@pytest.mark.asyncio
async def test_get_history_returns_persisted_entries(
    hass, registered_websocket_api, hass_owner_user, freezer, snapshot
) -> None:
    freezer.move_to("2026-11-06T12:00:00+00:00")
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
    )
    entry.add_to_hass(hass)
    history = HistoryStore(hass)
    entry.runtime_data = RuntimeData(config={"version": 1, "alerts": []}, history=history)
    await history.async_record("door", "Door", "notification_sent", "Sent")
    await history.async_record("water", "Water", "notification_sent", "Sent")
    token = await hass.auth.async_create_refresh_token(
        hass_owner_user, client_id="https://ha-notifications.test"
    )
    client = await registered_websocket_api(access_token=hass.auth.async_create_access_token(token))
    await client.send_json({"id": 1, "type": "ha_notifications/get_history", "alert_id": "door"})

    response = await client.receive_json()
    assert response["result"] == await history.async_entries("door")
    assert response == snapshot(matcher=_HISTORY_MATCHER)
    assert len(await history.async_entries("door")) == 1


def test_config_resolution_reads_options_not_runtime_cache(hass) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        options={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = RuntimeData(config={"version": 1, "alerts": [{"id": "stale"}]})

    assert websocket._config_for(hass) == {"version": 1, "alerts": []}


def test_automation_document_is_empty_without_loaded_entry(hass) -> None:
    assert websocket._automation_document(hass) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("panel_contents", ["custom panel", "updated panel"])
async def test_async_register_panel_registers_packaged_static_asset(
    hass,
    hass_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    panel_contents: str,
    snapshot,
) -> None:
    from homeassistant.setup import async_setup_component

    assert await async_setup_component(hass, "http", {})
    panel_path = tmp_path / "frontend" / "panel.js"
    panel_path.parent.mkdir()
    panel_path.write_text(panel_contents)
    brand_path = tmp_path / "brand"
    brand_path.mkdir()
    (brand_path / "icon.png").write_bytes(b"icon")

    import custom_components.ha_notifications.bridge as bridge

    monkeypatch.setattr(bridge, "__file__", str(tmp_path / "bridge" / "__init__.py"))
    monkeypatch.setattr(bridge, "_PANEL_REGISTERED", set())
    panels: list[dict[str, object]] = []

    async def register_panel(hass: object, **kwargs: object) -> None:
        panels.append(kwargs)

    monkeypatch.setattr(bridge.panel_custom, "async_register_panel", register_panel)

    await async_register_panel(hass)
    await async_register_panel(hass)
    client = await hass_client()
    panel_response = await client.get(PANEL_URL)
    assert panel_response.status == 200
    assert await panel_response.text() == panel_contents
    icon_response = await client.get(f"{BRAND_URL}/icon.png")
    assert icon_response.status == 200
    assert await icon_response.read() == b"icon"
    assert panels == snapshot


@pytest.mark.asyncio
async def test_get_config_can_skip_validation_for_yaml_repair(
    hass, registered_websocket_api, snapshot
) -> None:
    persisted = {
        "version": 1,
        "alerts": [{"id": "door", "triggers": []}],
    }
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        options=persisted,
    )
    entry.add_to_hass(hass)
    client = await registered_websocket_api()

    await client.send_json({"id": 1, "type": "ha_notifications/get_config", "validate": False})
    raw = await client.receive_json()
    await client.send_json({"id": 2, "type": "ha_notifications/get_config"})
    response = await client.receive_json()
    matcher = path_type(
        {r"validated\.error\.message": (str,)},
        regex=True,
        replacer=lambda data, match: re.sub(
            r"https://errors\.pydantic\.dev/\d+\.\d+/v/",
            "https://errors.pydantic.dev/<version>/v/",
            data,
        ),
    )
    assert {"raw": raw, "validated": response} == snapshot(matcher=matcher)
    assert dict(entry.options) == persisted


@pytest.mark.asyncio
async def test_get_config_returns_canonical_defaults(
    hass, registered_websocket_api, snapshot
) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        options={"version": 1, "alerts": [{"id": "door", "notification": {}}]},
    )
    entry.add_to_hass(hass)
    client = await registered_websocket_api()

    await client.send_json({"id": 1, "type": "ha_notifications/get_config"})
    response = await client.receive_json()
    assert response == snapshot


@pytest.mark.asyncio
async def test_get_config_creates_a_backend_default_alert(
    hass, registered_websocket_api, snapshot
) -> None:
    client = await registered_websocket_api()
    await client.send_json({"id": 1, "type": "ha_notifications/get_config", "new": True})
    response = await client.receive_json()
    config = response["result"]
    assert len(config["alerts"]) == 1
    assert config["alerts"][0]["id"].startswith("alert_")
    matcher = path_type({"result.alerts.0.id": (str,)}, replacer=lambda data, match: "<alert-id>")
    assert response == snapshot(matcher=matcher)
    first_id = config["alerts"][0]["id"]
    await client.send_json({"id": 2, "type": "ha_notifications/get_config", "new": True})
    response = await client.receive_json()

    assert response["result"]["alerts"][0]["id"] != first_id
    assert response == snapshot(matcher=matcher)
    assert not hass.config_entries.async_entries(DOMAIN)


@pytest.mark.asyncio
async def test_automation_status_projects_generated_automation_ownership(
    hass,
    alert_factory,
    snapshot,
    registered_websocket_api,
    history_mock,
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

    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        options={"version": 1, "alerts": alerts},
    )
    entry.add_to_hass(hass)
    history_mock.async_entries.return_value = await history_entries()
    document = [generate_automation(alert) for alert in alerts[:-1]]
    document[1]["initial_state"] = False
    document[2]["description"] = "User-owned automation"
    entry.runtime_data = RuntimeData(
        config=dict(entry.options), automations=document, history=history_mock
    )
    hass.states.async_set("automation.ha_notifications_base_alert", "on")
    hass.states.async_set("automation.ha_notifications_demo", "off")
    hass.states.async_set("automation.ha_notifications_notification_alert", "on", {"current": 1})
    hass.states.async_set("automation.ha_notifications_inactive_notification_alert", "off")
    client = await registered_websocket_api()
    await client.send_json({"id": 1, "type": "ha_notifications/automation_status"})
    assert await client.receive_json() == snapshot


def test_active_flow_ids_track_parallel_runs_independently() -> None:
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

    assert active_flow_ids(entries, "door") == ["cancelled-run"]


def test_cancelled_history_is_terminal_for_its_flow() -> None:
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

    assert active_flow_ids(entries, "door") == []


@pytest.mark.asyncio
@pytest.mark.parametrize(("enabled", "should_reenable"), [(True, True), (False, False)])
async def test_cancel_run_stops_actions_and_preserves_enabled_alert(
    hass,
    alert_factory,
    enabled: bool,
    should_reenable: bool,
    snapshot,
    freezer,
) -> None:
    from custom_components.ha_notifications.const import (
        COMMAND_CANCEL_RUN,
        DOMAIN,
        EVENT_COMMAND,
    )

    freezer.move_to("2026-11-05T12:00:00+00:00")
    alert = alert_factory("base", id="door", enabled=enabled)
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    history = HistoryStore(hass)
    entry.runtime_data = RuntimeData(config=dict(entry.options), history=history)
    hass.states.async_set("automation.ha_notifications_door", "on")
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

    assert len(turn_off) == 1
    assert len(turn_on) == int(should_reenable)
    if not should_reenable:
        assert turn_on == []
    entries = await history.async_entries("door")
    assert {
        "result": result,
        "commands": [dict(event.data) for event in command_events],
        "turn_off": [dict(call.data) for call in turn_off],
        "turn_on": [dict(call.data) for call in turn_on],
        "history": entries,
    } == snapshot(matcher=_HISTORY_MATCHER)
    assert (
        sum(
            item["event"]["type"] == "cancelled"
            for item in entries
            if item["event"].get("flow_id") == "run-1"
        )
        == 1
    )
    assert (
        active_flow_ids(
            await history.async_entries("door"),
            "door",
        )
        == []
    )


async def test_automation_runtime_status_contract(
    hass,
    alert_factory,
    snapshot,
) -> None:
    alert = alert_factory("base")
    document = [
        {
            "id": "ha_notifications_base_alert",
            "description": "Generated by HA Notifications. Do not edit manually.",
        }
    ]
    unregistered = automation_runtime_status(hass, document, alert)
    entity = er.async_get(hass).async_get_or_create(
        "automation",
        "automation",
        "ha_notifications_base_alert",
        suggested_object_id="renamed_automation",
    )
    hass.states.async_set(entity.entity_id, "on", {"current": 2})

    running = automation_runtime_status(hass, [], alert)
    hass.states.async_remove(entity.entity_id)
    missing = automation_runtime_status(
        hass,
        document,
        alert,
    )

    assert {"unregistered": unregistered, "running": running, "missing": missing} == snapshot
