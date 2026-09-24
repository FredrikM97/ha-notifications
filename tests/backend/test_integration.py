"""Home Assistant integration lifecycle tests."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from homeassistant.core import Context, HomeAssistant
from pydantic import ValidationError
from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.ha_notifications.bridge import websocket
from custom_components.ha_notifications.const import (
    DOMAIN,
    EVENT_NOTIFICATION_ACTION,
    SERVICE_RELOAD,
    SERVICE_TEST,
)
from custom_components.ha_notifications.support.storage import Storage


class RecordingConnection:
    """Capture Home Assistant websocket adapter responses for integration tests."""

    def __init__(self) -> None:
        self.results: list[tuple[object, object]] = []
        self.errors: list[tuple[object, str, str]] = []

    def send_result(self, message_id: object, result: object) -> None:
        self.results.append((message_id, result))

    def send_error(self, message_id: object, code: str, message: str) -> None:
        self.errors.append((message_id, code, message))


async def invoke_websocket_handler(
    hass: HomeAssistant,
    controller,
    message: dict[str, object],
) -> RecordingConnection:
    """Invoke one real registered route through the transport adapter."""

    lifecycle = SimpleNamespace(
        websocket_routes=controller._lifecycle.websocket_routes,
        wait_until_ready=controller._lifecycle.wait_until_ready,
        dispatch=controller.dispatch,
    )
    handlers: list = []
    websocket.register(lifecycle, handlers.append)
    command = str(message["type"]).split("/")[-1]
    route_index = next(
        index
        for index, route in enumerate(lifecycle.websocket_routes)
        if route.command == command
    )
    connection = RecordingConnection()
    handlers[route_index](hass, connection, {"id": 1, **message})
    await hass.async_block_till_done()
    return connection


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_loaded_entry_registers_services(
    hass: HomeAssistant,
    loaded_config_entry,
) -> None:
    """A config entry loads the integration and exposes its public services."""
    assert loaded_config_entry.state.value == "loaded"
    assert hass.services.has_service(DOMAIN, SERVICE_RELOAD)
    assert hass.services.has_service(DOMAIN, SERVICE_TEST)

    assert await hass.config_entries.async_unload(loaded_config_entry.entry_id)
    await hass.async_block_till_done()
    assert hass.services.has_service(DOMAIN, SERVICE_RELOAD)
    assert hass.services.has_service(DOMAIN, SERVICE_TEST)

    await hass.config_entries.async_remove(loaded_config_entry.entry_id)
    await hass.async_block_till_done()
    assert not hass.services.has_service(DOMAIN, SERVICE_RELOAD)
    assert not hass.services.has_service(DOMAIN, SERVICE_TEST)


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_configuration_is_persisted_in_entry_options(
    hass: HomeAssistant,
    loaded_config_entry,
) -> None:
    """Structured alert configuration uses Home Assistant config-entry storage."""
    storage = Storage(
        hass,
        loaded_config_entry,
    )
    config = {
        "version": 1,
        "alerts": [{"id": "demo", "name": "Demo"}],
    }

    saved = await storage.save_config(config)
    assert saved["version"] == 1
    assert saved["alerts"][0]["id"] == "demo"
    assert loaded_config_entry.options == saved
    assert await storage.load_config() == saved


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_entry_option_updates_reload_live_configuration(
    hass: HomeAssistant,
    loaded_config_entry,
) -> None:
    """ConfigEntry option changes are applied by the controller listener."""
    storage = Storage(
        hass,
        loaded_config_entry,
    )
    await storage.save_config(
        {
            "version": 1,
            "alerts": [{"id": "demo", "name": "Demo"}],
        }
    )
    await hass.async_block_till_done()

    controller = loaded_config_entry.runtime_data
    assert await controller.dispatch("alerts.get", "demo") is not None


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_sensor_state_change_runs_real_notification_workflow(
    hass: HomeAssistant,
    loaded_config_entry,
    snapshot,
) -> None:
    """A real Home Assistant state change reaches notification delivery."""

    service_calls = async_mock_service(hass, "notify", "send_message")
    hass.states.async_set("sensor.trigger_sensor", "off")
    await hass.async_block_till_done()

    alert = {
        "id": "sensor_alert",
        "name": "Sensor alert",
        "conditions": [
            {
                "type": "state",
                "entity_id": ["sensor.trigger_sensor"],
                "state": ["on"],
            }
        ],
        "monitor": {"on_change": True, "startup": False},
        "notification": {
            "target": {"entity_id": ["notify.test"]},
            "title": "Sensor changed",
            "message": "The sensor is on",
        },
    }
    controller = loaded_config_entry.runtime_data
    await controller.dispatch(
        "configuration.save_config", {"version": 1, "alerts": [alert]}
    )
    await controller.reload()
    await hass.async_block_till_done()
    history = await controller.dispatch(
        "history.list", alert_id="sensor_alert"
    )
    assert {
        "service_calls": [call.data for call in service_calls],
        "history": [
            {
                "type": entry["event"]["type"],
                "source": entry["event"]["details"].get("source"),
            }
            for entry in history
        ],
    } == snapshot


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_notification_action_event_runs_real_confirmation_workflow(
    hass: HomeAssistant,
    loaded_config_entry,
) -> None:
    """A real Home Assistant notification action confirms an active alert."""

    service_calls = async_mock_service(hass, "notify", "send_message")
    user = await hass.auth.async_create_user("Alice")
    hass.states.async_set(
        "person.alice",
        "home",
        {"user_id": user.id, "friendly_name": "Alice"},
    )
    hass.states.async_set("sensor.confirmation_sensor", "off")
    await hass.async_block_till_done()

    alert = {
        "id": "confirmation_sensor_alert",
        "name": "Confirmation sensor alert",
        "conditions": [
            {
                "type": "state",
                "entity_id": ["sensor.confirmation_sensor"],
                "state": ["on"],
            }
        ],
        "monitor": {"on_change": True, "startup": False},
        "notification": {
            "target": {"entity_id": ["notify.test"]},
            "title": "Confirm sensor",
            "message": "Please confirm",
        },
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
        },
    }
    controller = loaded_config_entry.runtime_data
    await controller.dispatch(
        "configuration.save_config", {"version": 1, "alerts": [alert]}
    )
    await controller.reload()
    await hass.async_block_till_done()

    hass.states.async_set("sensor.confirmation_sensor", "on")
    await hass.async_block_till_done()

    assert len(service_calls) == 1
    runtime = await controller.dispatch(
        "alerts.runtime", "confirmation_sensor_alert"
    )
    pending = next(
        item for item in runtime["trace"] if item.get("action_ids")
    )
    action_id = next(iter(pending["action_ids"]))

    hass.bus.async_fire(
        EVENT_NOTIFICATION_ACTION,
        {"action": action_id},
        context=Context(user_id=user.id),
    )
    await hass.async_block_till_done()

    updated = await controller.dispatch(
        "alerts.runtime", "confirmation_sensor_alert"
    )
    assert updated["state"]["acknowledged"] is True
    assert updated["state"]["confirmed_by"] == "Alice"
    history = await controller.dispatch(
        "history.list", alert_id="confirmation_sensor_alert"
    )
    assert any(
        entry["event"]["type"] == "confirmed"
        and entry["event"]["details"]["confirmed_by"] == "Alice"
        for entry in history
    )


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_unloading_entry_removes_sensor_condition_watcher(
    hass: HomeAssistant,
    loaded_config_entry,
) -> None:
    """Unloading the entry removes real Home Assistant condition listeners."""

    service_calls = async_mock_service(hass, "notify", "send_message")
    hass.states.async_set("sensor.unload_sensor", "off")
    await hass.async_block_till_done()
    alert = {
        "id": "unload_sensor_alert",
        "name": "Unload sensor alert",
        "conditions": [
            {
                "type": "state",
                "entity_id": ["sensor.unload_sensor"],
                "state": ["on"],
            }
        ],
        "monitor": {"on_change": True, "startup": False},
        "notification": {
            "target": {"entity_id": ["notify.test"]},
            "title": "Unload",
            "message": "Should not be sent after unload",
        },
    }
    controller = loaded_config_entry.runtime_data
    await controller.dispatch(
        "configuration.save_config", {"version": 1, "alerts": [alert]}
    )
    await controller.reload()
    await hass.async_block_till_done()

    assert await hass.config_entries.async_unload(loaded_config_entry.entry_id)
    await hass.async_block_till_done()
    hass.states.async_set("sensor.unload_sensor", "on")
    await hass.async_block_till_done()

    assert service_calls == []


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_history_round_trips_through_real_home_assistant_store(
    hass: HomeAssistant,
    loaded_config_entry,
) -> None:
    """History persists through Home Assistant's real Store implementation."""

    storage = Storage(hass, loaded_config_entry)
    event = {
        "config": {"id": "stored_alert"},
        "event": {"type": "notification_sent"},
    }
    await storage.store_event(event)
    await storage.save_history()

    reloaded = Storage(hass, loaded_config_entry)
    await reloaded.load_history()

    assert reloaded.history == [event]


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_invalid_configuration_save_preserves_existing_runtime(
    hass: HomeAssistant,
    loaded_config_entry,
    notification_alert_factory,
) -> None:
    """Invalid route input cannot overwrite valid persisted configuration."""

    controller = loaded_config_entry.runtime_data
    valid = {"version": 1, "alerts": [notification_alert_factory()]}
    await controller.dispatch("configuration.save_config", valid)
    await controller.reload()
    before = loaded_config_entry.options

    with pytest.raises(ValidationError):
        await controller.dispatch(
            "configuration.save_config",
            {"version": 1, "alerts": [{"name": "Missing id"}]},
        )

    assert loaded_config_entry.options == before
    assert await controller.dispatch("alerts.get", "alert_1") is not None


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_frontend_command_contract_matches_registered_backend_routes(
    loaded_config_entry,
) -> None:
    """Every frontend command has exactly one registered backend route."""

    contract = json.loads(
        (Path(__file__).parents[1] / "contracts" / "routes.json").read_text()
    )
    commands = {
        route.command
        for route in loaded_config_entry.runtime_data._lifecycle.websocket_routes
    }

    assert commands == set(contract["commands"])


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_all_websocket_routes_return_real_adapter_responses(
    hass: HomeAssistant,
    loaded_config_entry,
    alert_factory,
) -> None:
    """Exercise every public websocket command through the HA adapter."""

    controller = loaded_config_entry.runtime_data
    alert = alert_factory("websocket_alert")
    config = {"version": 1, "alerts": [alert]}
    messages = [
        {"type": "ha_notifications/save_config", "config": config},
        {"type": "ha_notifications/reload"},
        {"type": "ha_notifications/save", "alert": alert},
        {"type": "ha_notifications/list"},
        {"type": "ha_notifications/runtime"},
        {"type": "ha_notifications/preview_payload", "alert": alert},
        {"type": "ha_notifications/validate_conditions", "alert": alert},
        {
            "type": "ha_notifications/history",
            "alert_id": alert["id"],
            "limit": 100,
        },
        {"type": "ha_notifications/get_config"},
        {"type": "ha_notifications/validate_config", "config": config},
        {"type": "ha_notifications/delete", "alert_id": alert["id"]},
    ]

    for message in messages:
        response = await invoke_websocket_handler(hass, controller, message)
        assert response.errors == [], (message, response.errors)
        assert response.results and response.results[0][0] == 1

    invalid = await invoke_websocket_handler(
        hass,
        controller,
        {
            "type": "ha_notifications/save_config",
            "config": {"version": 1, "alerts": [{"name": "Missing id"}]},
        },
    )
    assert invalid.results == []
    assert invalid.errors
    assert invalid.errors[0][1] == "save_config_failed"


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_alert_routes_preserve_the_save_reload_edit_delete_flow(
    hass: HomeAssistant,
    loaded_config_entry,
    alert_factory,
) -> None:
    """Exercise the core alert lifecycle through the application routes."""

    controller = loaded_config_entry.runtime_data
    alert = alert_factory("flow_alert")

    await controller.dispatch(
        "configuration.save_config", {"version": 1, "alerts": [alert]}
    )
    await controller.dispatch("configuration.reload")

    config = await controller.dispatch("configuration.get_config")
    assert config["alerts"][0]["id"] == "flow_alert"
    assert await controller.dispatch("configuration.validate_config", config)
    assert await controller.dispatch("alerts.get", "flow_alert") is not None
    assert "flow_alert" in await controller.dispatch("alerts.runtime_mapping")
    history = await controller.dispatch("history.list", alert_id="flow_alert")
    assert all(entry["config"]["id"] == "flow_alert" for entry in history)
    assert await controller.dispatch("conditions.validate", alert)

    updated = {**alert, "name": "Updated alert", "enabled": False}
    saved = await controller.dispatch("alerts.save", updated)
    assert saved["name"] == "Updated alert"
    assert (await controller.dispatch("alerts.get", "flow_alert"))["enabled"] is False

    assert await controller.dispatch("alerts.delete", "flow_alert")
    assert await controller.dispatch("alerts.get", "flow_alert") is None


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_frontend_runtime_request_reaches_real_backend_route(
    hass: HomeAssistant,
    loaded_config_entry,
    notification_alert_factory,
) -> None:
    """The frontend runtime message reaches the real HA integration route."""

    contract = json.loads(
        (
            Path(__file__).parents[1] / "contracts" / "runtime.json"
        ).read_text()
    )
    controller = loaded_config_entry.runtime_data
    await controller.dispatch(
        "configuration.save_config",
        {"version": 1, "alerts": [notification_alert_factory()]},
    )
    await controller.reload()
    route = next(
        route
        for route in controller._lifecycle.websocket_routes
        if route.command == "runtime"
    )
    lifecycle = SimpleNamespace(
        websocket_routes=(route,),
        wait_until_ready=controller._lifecycle.wait_until_ready,
        dispatch=controller.dispatch,
    )
    handlers = []
    websocket.register(lifecycle, handlers.append)

    connection = RecordingConnection()
    handlers[0](hass, connection, {"id": 1, **contract["request"]})
    await hass.async_block_till_done()

    assert connection.errors == []
    assert connection.results[0][0] == 1
    runtime = connection.results[0][1]
    assert isinstance(runtime, dict)
    assert set(runtime) == {"alert_1"}
    assert all("trace" in state for state in runtime.values())