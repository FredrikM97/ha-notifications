"""Home Assistant integration lifecycle tests."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from homeassistant.core import HomeAssistant
from pydantic import ValidationError

from custom_components.ha_notifications.bridge import websocket
from custom_components.ha_notifications.const import (
    DOMAIN,
    SERVICE_RELOAD,
    SERVICE_TEST,
)
from custom_components.ha_notifications.support.storage import Storage
from tests.backend.conftest import make_alert, make_notification_alert


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
async def test_invalid_configuration_save_preserves_existing_runtime(
    hass: HomeAssistant,
    loaded_config_entry,
) -> None:
    """Invalid route input cannot overwrite valid persisted configuration."""

    controller = loaded_config_entry.runtime_data
    valid = {"version": 1, "alerts": [make_notification_alert()]}
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
) -> None:
    """Exercise every public websocket command through the HA adapter."""

    controller = loaded_config_entry.runtime_data
    alert = make_alert("websocket_alert")
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
) -> None:
    """Exercise the core alert lifecycle through the application routes."""

    controller = loaded_config_entry.runtime_data
    alert = make_alert("flow_alert")

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
        {"version": 1, "alerts": [make_notification_alert()]},
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