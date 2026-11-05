"""Tests for the Home Assistant Notifications config-entry lifecycle."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from homeassistant.components import automation as ha_automation
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import label_registry as lr
from homeassistant.setup import async_setup_component
from pytest_homeassistant.common import MockConfigEntry, async_fire_time_changed

from custom_components import ha_notifications
from custom_components.ha_notifications import RuntimeData
from custom_components.ha_notifications.automation import (
    automation_id,
)
from custom_components.ha_notifications.bridge.websocket import WebsocketDispatcher
from custom_components.ha_notifications.const import (
    AUTOMATION_CATEGORY_SCOPE,
    AUTOMATION_LABEL,
    CONFIG_ENTRY_MINOR_VERSION,
    CONFIG_ENTRY_VERSION,
    DOMAIN,
)


@pytest.fixture
def mock_register_panel(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ha_notifications, "async_register_panel", AsyncMock())


@pytest.mark.parametrize("version", [3, CONFIG_ENTRY_VERSION], ids=["migrated", "current"])
async def test_config_entry_manager_setup_reload_and_unload(
    hass: HomeAssistant,
    alert_factory,
    mock_notification_dependencies,
    hass_storage,
    version: int,
) -> None:
    alert = alert_factory("base")
    config = {"version": 1, "alerts": [alert]}
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=version,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        data=config if version == 3 else {},
        options={} if version == 3 else config,
    )
    entry.add_to_hass(hass)
    history_entry = {
        "config": {"id": alert["id"], "name": alert["name"]},
        "event": {
            "event_id": "persisted-event",
            "type": "notification_sent",
            "timestamp": datetime.now(UTC).isoformat(),
            "message": "Sent",
            "details": {},
        },
    }
    hass_storage["ha_notifications.history"] = {
        "version": 1,
        "data": {"entries": [history_entry]},
    }

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    assert entry.version == CONFIG_ENTRY_VERSION
    assert entry.data == {}
    assert isinstance(entry.runtime_data, RuntimeData)
    first_runtime = entry.runtime_data
    assert first_runtime.automations
    assert await first_runtime.history.async_entries() == [history_entry]
    for service in ("send", "clear", "report", "command"):
        assert hass.services.has_service(DOMAIN, service)

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    assert entry.runtime_data is not first_runtime
    assert entry.runtime_data.config == first_runtime.config
    assert await entry.runtime_data.history.async_entries() == [history_entry]

    last_runtime = entry.runtime_data
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.NOT_LOADED
    assert not hasattr(entry, "runtime_data")
    for service in ("send", "clear", "report", "command"):
        assert not hass.services.has_service(DOMAIN, service)
    hass.config_entries.async_update_entry(entry, options={"version": 1, "alerts": []})
    await hass.async_block_till_done()
    assert last_runtime.config == first_runtime.config


async def test_config_entry_manager_keeps_invalid_config_available_for_repair(
    hass: HomeAssistant, mock_notification_dependencies
) -> None:
    invalid = {"version": 1, "alerts": [{"id": "broken", "triggers": []}]}
    entry = MockConfigEntry(
        domain=DOMAIN,
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        options=invalid,
    )
    entry.add_to_hass(hass)

    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.LOADED
    assert dict(entry.options) == invalid
    assert entry.runtime_data.config == {"version": 1, "alerts": []}
    assert entry.runtime_data.automations == []
    assert entry.runtime_data.remove_update_listener is not None


async def test_native_automation_api_loads_by_id_and_recovers_unloaded_record(
    hass,
    automation_api,
    snapshot,
) -> None:
    """Exercise HA's real config API persistence and targeted reload hook."""
    unrelated = {
        "id": "unrelated",
        "alias": "Unrelated",
        "triggers": [],
        "actions": [],
        "initial_state": False,
    }
    automation_api.prepare(automations=[unrelated])
    assert await async_setup_component(hass, "automation", {"automation": [unrelated]})
    await hass.async_block_till_done()
    component = hass.data[ha_automation.DATA_COMPONENT]
    original_entity = component.get_entity("automation.unrelated")
    assert original_entity is not None
    document = {
        "id": "ha_notifications_api_test",
        "alias": "API test",
        "description": "Generated by HA Notifications. Do not edit manually.",
        "triggers": [],
        "actions": [],
        "initial_state": False,
    }
    reloads = []

    @callback
    def record_reload(event):
        if event.data["domain"] == "automation" and event.data["service"] == "reload":
            reloads.append(event.data["service_data"])

    hass.bus.async_listen("call_service", record_reload)
    await automation_api.post(document)
    await hass.async_block_till_done()
    entity_id = "automation.api_test"
    assert hass.states.get(entity_id).state == "off"
    assert component.get_entity(entity_id).raw_config == document
    assert len(reloads) == 1
    stored = automation_api.stored()
    assert document in stored

    await component.get_entity(entity_id).async_remove()
    assert component.get_entity(entity_id) is None
    assert hass.states.get(entity_id).state == "unavailable"
    await hass.services.async_call(
        "automation",
        "reload",
        {"id": document["id"]},
        blocking=True,
    )
    await hass.async_block_till_done()

    assert component.get_entity(entity_id).raw_config == document
    assert hass.states.get(entity_id).state == "off"
    assert component.get_entity("automation.unrelated") is original_entity
    assert automation_api.stored() == stored
    assert {"stored": stored, "reloads": reloads} == snapshot


def _monitor(
    *,
    triggers: list[dict[str, object]] | None = None,
    conditions: list[dict[str, object]] | None = None,
    startup: bool = False,
    interval_enabled: bool = False,
    interval: int = 43200,
) -> dict[str, object]:
    return {
        "inactive": {"enabled": False, "items": [], "clear_notification": False},
        "triggers": {
            "enabled": True,
            "items": triggers or [],
        },
        "conditions": {
            "enabled": True,
            "items": conditions or [],
            "startup": startup,
            "interval": {"enabled": interval_enabled, "value": interval},
        },
    }


async def _wait_for_history_events(
    runtime: RuntimeData,
    alert_id: str,
    event_type: str,
    count: int = 1,
) -> None:
    async with asyncio.timeout(5):
        while (
            sum(
                item["event"]["type"] == event_type
                for item in await runtime.history.async_entries(alert_id)
            )
            < count
        ):
            await asyncio.sleep(0)


async def test_config_entry_updates_prepare_automations_without_api_or_file_io(
    hass: HomeAssistant,
    mock_register_panel,
    alert_factory,
) -> None:
    """Prepare documents for the frontend API without backend file access."""

    reload_calls: list[object] = []
    hass.services.async_register(
        "automation",
        "reload",
        lambda call: reload_calls.append(call),
    )
    alert = alert_factory("base")
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    automations_path = Path(hass.config.path("automations.yaml"))
    configuration_path = Path(hass.config.path("configuration.yaml"))
    configuration_path.write_text("automation: !include automations.yaml\n")
    automations_path.write_text("- id: user_automation\n  alias: User\n")
    originals = (configuration_path.read_bytes(), automations_path.read_bytes())

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    generated_id = automation_id(alert)
    assert reload_calls == []
    assert (configuration_path.read_bytes(), automations_path.read_bytes()) == originals
    assert entry.runtime_data.automations[0]["id"] == generated_id
    assert hass.services.has_service(DOMAIN, "send")
    assert hass.services.has_service(DOMAIN, "clear")

    updated = alert_factory("base")
    updated["name"] = "Updated alert"
    hass.config_entries.async_update_entry(
        entry,
        options={"version": 1, "alerts": [updated]},
    )
    await hass.async_block_till_done()
    assert reload_calls == []
    assert entry.runtime_data.automations[0]["alias"] == "HA Notifications: Updated alert"

    assert await ha_notifications.async_unload_entry(hass, entry)
    await hass.async_block_till_done()
    assert reload_calls == []
    assert (configuration_path.read_bytes(), automations_path.read_bytes()) == originals
    assert not hass.services.has_service(DOMAIN, "send")
    assert not hass.services.has_service(DOMAIN, "clear")
    assert await ha_notifications.async_unload_entry(hass, entry)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    assert reload_calls == []
    assert entry.runtime_data.automations[0]["id"] == generated_id


async def test_config_entry_update_targets_changed_and_deleted_alerts(
    hass: HomeAssistant,
    monkeypatch,
    mock_register_panel,
    alert_factory,
) -> None:
    """Prepare complete generated documents when persisted alerts change."""

    prepared: list[list[dict[str, object]]] = []

    async def prepare(_hass, alerts):
        prepared.append(alerts)
        return []

    monkeypatch.setattr(ha_notifications, "async_validate_alerts", prepare)
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={
            "version": 1,
            "alerts": [alert_factory("base"), alert_factory("persisted")],
        },
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    prepared.clear()

    updated = alert_factory("base")
    updated["name"] = "Updated alert"
    hass.config_entries.async_update_entry(
        entry,
        options={"version": 1, "alerts": [updated]},
    )
    await hass.async_block_till_done()

    assert prepared == [entry.runtime_data.config["alerts"]]


@pytest.mark.parametrize(
    "failure_phase,error",
    [
        ("validation", "automation validation failed"),
        ("entry_update", "Entry update failed"),
    ],
)
async def test_async_save_config_rolls_back_entry_and_runtime_on_failure(
    hass: HomeAssistant,
    monkeypatch,
    mock_register_panel,
    alert_factory,
    failure_phase,
    error,
) -> None:
    """Keep persisted configuration unchanged when automation validation fails."""

    alert = alert_factory("base")
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    previous = entry.runtime_data.config
    previous_automations = entry.runtime_data.automations
    previous_options = dict(entry.options)
    if failure_phase == "validation":
        entry.runtime_data.remove_update_listener()
        monkeypatch.setattr(
            ha_notifications, "async_validate_alerts", AsyncMock(side_effect=RuntimeError(error))
        )
    else:

        def fail_update(*_args, **_kwargs):
            raise RuntimeError(error)

        monkeypatch.setattr(hass.config_entries, "async_update_entry", fail_update)
    updated = alert_factory("base")
    updated["name"] = "Updated alert"

    with pytest.raises(RuntimeError, match=error):
        await ha_notifications.async_save_config(
            hass,
            entry,
            {"version": 1, "alerts": [updated]},
        )

    assert dict(entry.options) == previous_options
    assert isinstance(entry.runtime_data, RuntimeData)
    assert entry.runtime_data.config is previous
    assert entry.runtime_data.automations is previous_automations


async def test_save_response_and_update_listener_reuse_validated_automations(
    hass: HomeAssistant,
    monkeypatch,
    mock_register_panel,
    alert_factory,
) -> None:
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        options={"version": 1, "alerts": [alert_factory("base")]},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    prepare = AsyncMock(wraps=ha_notifications.async_validate_alerts)
    monkeypatch.setattr(ha_notifications, "async_validate_alerts", prepare)
    updated = {**alert_factory("base"), "name": "Updated"}
    dispatcher = WebsocketDispatcher()

    result = await dispatcher.save_config(
        hass,
        {"config": {"version": 1, "alerts": [updated]}},
    )
    await hass.async_block_till_done()
    configuration = await dispatcher.get_automations(hass, {})

    prepare.assert_awaited_once()
    assert result["automation_changes"] == configuration
    assert configuration["upsert"] is entry.runtime_data.automations


@pytest.mark.parametrize("operation", ["save_alert", "save_config", "delete"])
async def test_mutations_return_only_explicit_automation_operations(
    hass: HomeAssistant,
    monkeypatch,
    mock_register_panel,
    alert_factory,
    operation,
    snapshot,
) -> None:
    from custom_components.ha_notifications.bridge import websocket

    first = alert_factory("base")
    other = alert_factory("persisted")
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        options={"version": 1, "alerts": [first, other]},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    original_other = entry.runtime_data.automations[1]

    def unexpected_discovery(*_args):
        pytest.fail("Ordinary saves and deletes must not discover automation IDs")

    monkeypatch.setattr(websocket, "stale_automation_ids", unexpected_discovery)
    dispatcher = WebsocketDispatcher()
    if operation == "save_alert":
        result = await dispatcher.save_config(hass, {"alert": {**first, "enabled": False}})
        assert entry.runtime_data.automations[1] == original_other
    else:
        result = await (
            dispatcher.delete(hass, {"alert_id": first["id"]})
            if operation == "delete"
            else dispatcher.save_config(hass, {"config": {"version": 1, "alerts": [other]}})
        )
    await hass.async_block_till_done()
    assert result == snapshot
    assert dict(entry.options) == result["config"]
    assert entry.runtime_data.config == result["config"]


async def test_validate_config_checks_draft_alert_with_saved_alerts_without_persisting(
    hass: HomeAssistant,
    mock_register_panel,
    alert_factory,
    snapshot,
) -> None:
    first = alert_factory("base")
    other = alert_factory("persisted")
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        options={"version": 1, "alerts": [first, other]},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    stored = dict(entry.options)
    dispatcher = WebsocketDispatcher()

    validated = await dispatcher.validate_config(hass, {"alert": {**first, "name": "Draft"}})
    added = await dispatcher.validate_config(hass, {"alert": {**first, "id": "new_alert"}})

    assert {"updated": validated, "added": added} == snapshot
    assert dict(entry.options) == stored
    with pytest.raises(ValueError):
        await dispatcher.validate_config(hass, {"alert": {**first, "id": "Bad ID"}})
    for command in (dispatcher.validate_config, dispatcher.save_config):
        with pytest.raises(ValueError, match="Provide either config or alert"):
            await command(hass, {})
    assert dict(entry.options) == stored


async def test_explicit_reload_recovers_stale_ids_after_a_failed_deletion(
    hass: HomeAssistant,
    mock_register_panel,
    alert_factory,
    snapshot,
) -> None:
    alert = alert_factory("base")
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    registry = er.async_get(hass)
    registry.async_get_or_create("automation", "automation", automation_id(alert))
    registry.async_get_or_create("automation", "automation", "user_automation")
    dispatcher = WebsocketDispatcher()
    await dispatcher.delete(hass, {"alert_id": alert["id"]})

    result = await dispatcher.get_automations(hass, {})

    assert result == snapshot
    await hass.async_block_till_done()


@pytest.mark.parametrize("registered_before_setup", [False, True])
async def test_backend_tags_actual_entities_without_frontend_polling(
    hass: HomeAssistant,
    mock_register_panel,
    alert_factory,
    registered_before_setup,
    snapshot,
) -> None:
    alert = alert_factory("base")
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    registry = er.async_get(hass)
    personal = lr.async_get(hass).async_create(name="Personal")

    def register_entity():
        entity = registry.async_get_or_create(
            "automation",
            "automation",
            automation_id(alert),
            suggested_object_id="renamed_alert_2",
        )
        entity = registry.async_get(entity.entity_id)
        registry.async_update_entity(
            entity.entity_id,
            labels=entity.labels | {personal.label_id},
            categories={**entity.categories, "custom": "retained"},
        )
        return entity.entity_id

    if registered_before_setup:
        entity_id = register_entity()
        await hass.async_block_till_done()
    assert await ha_notifications.async_setup_entry(hass, entry)
    if not registered_before_setup:
        entity_id = register_entity()
    user_entity = registry.async_get_or_create("automation", "automation", "user_automation")
    await hass.async_block_till_done()
    entity = registry.async_get(entity_id)
    managed_label = lr.async_get(hass).async_get_label_by_name(AUTOMATION_LABEL)
    assert {
        "labels": entity.labels,
        "managed_label": managed_label.label_id,
        "personal_label": personal.label_id,
        "custom_category": entity.categories["custom"],
        "hidden_by": entity.hidden_by,
        "unrelated_labels": registry.async_get(user_entity.entity_id).labels,
    } == snapshot
    assert AUTOMATION_CATEGORY_SCOPE in entity.categories

    listeners = hass.bus.async_listeners()[er.EVENT_ENTITY_REGISTRY_UPDATED]
    assert await ha_notifications.async_unload_entry(hass, entry)
    assert hass.bus.async_listeners().get(er.EVENT_ENTITY_REGISTRY_UPDATED, 0) == listeners - 1


@pytest.mark.parametrize(
    ("condition_state", "skip_condition", "should_deliver"),
    [("on", False, True), ("off", False, False), ("off", True, True)],
)
async def test_generated_automation_executes_lifecycle_delivery(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    condition_state: str,
    skip_condition: bool,
    should_deliver: bool,
    snapshot,
) -> None:
    """Respect conditions unless an explicit manual trigger bypasses them."""

    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    hass.states.async_set("binary_sensor.door", condition_state)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})
    alert = alert_factory(
        "base",
        monitor=_monitor(
            startup=True,
            conditions=[
                {
                    "condition": "state",
                    "entity_id": "binary_sensor.door",
                    "state": "on",
                }
            ],
        ),
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    assert hass.states.get("automation.ha_notifications_test_alert") is not None
    await hass.services.async_call(
        "automation",
        "trigger",
        {
            "entity_id": "automation.ha_notifications_test_alert",
            "skip_condition": skip_condition,
        },
        blocking=True,
    )
    await hass.async_block_till_done()

    assert bool(delivered) is should_deliver
    assert delivered == snapshot


async def test_generated_automation_reports_inactive_without_clearing(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    snapshot,
) -> None:
    """Execute an inactive detector without clearing prior notifications."""

    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("binary_sensor.door", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            conditions=[
                {
                    "condition": "state",
                    "entity_id": "binary_sensor.door",
                    "state": "on",
                }
            ],
            triggers=[
                {"trigger": "state", "entity_id": "binary_sensor.door"},
                {"trigger": "homeassistant", "event": "start"},
            ],
        ),
        notification={
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.mobile_app_phone"]},
            "title": "",
            "message": "Door open",
            "options": {},
        },
    )
    alert["monitor"]["inactive"] = {
        "enabled": True,
        "items": [
            {
                "trigger": "state",
                "entity_id": "binary_sensor.door",
                "to": "off",
            }
        ],
        "clear_notification": False,
    }
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()

    hass.bus.async_fire(EVENT_HOMEASSISTANT_STARTED)
    await hass.async_block_till_done()
    history = await entry.runtime_data.history.async_entries("base_alert")
    assert history == []

    hass.states.async_set("binary_sensor.door", "on")
    await hass.async_block_till_done()
    hass.states.async_set("binary_sensor.door", "off")
    await hass.async_block_till_done()

    history = await entry.runtime_data.history.async_entries("base_alert")
    assert {
        "notifications": delivered,
        "history_events": [item["event"]["type"] for item in history],
    } == snapshot


async def test_generated_automation_executes_startup_trigger(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    snapshot,
) -> None:
    """Execute a generated automation from the Home Assistant start event."""

    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})
    alert = alert_factory(
        "base",
        monitor=_monitor(startup=True),
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    hass.bus.async_fire(EVENT_HOMEASSISTANT_STARTED)
    await hass.async_block_till_done()

    assert delivered == snapshot


async def test_generated_automation_executes_interval_trigger(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    freezer,
    snapshot,
) -> None:
    """Execute a generated automation from a time-pattern trigger."""
    start = (datetime.now(UTC) + timedelta(minutes=1)).replace(second=1, microsecond=0)
    freezer.move_to(start)

    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})
    alert = alert_factory(
        "base",
        monitor=_monitor(interval_enabled=True, interval=10),
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    delivered.clear()
    async_fire_time_changed(hass, start + timedelta(seconds=8))
    await hass.async_block_till_done()
    assert delivered == []
    async_fire_time_changed(hass, start + timedelta(seconds=9))
    freezer.move_to(start + timedelta(seconds=9))
    await hass.async_block_till_done()
    await ha_notifications.async_unload_entry(hass, entry)
    await hass.async_block_till_done()

    assert delivered == snapshot


async def test_generated_native_for_trigger_uses_ha_clock_across_reload(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    snapshot,
) -> None:
    """Use native HA timing across an automation reload."""

    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})
    hass.states.async_set("sensor.temperature", "20")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[{"trigger": "state", "entity_id": "sensor.temperature"}],
            conditions=[
                {
                    "condition": "numeric_state",
                    "entity_id": "sensor.temperature",
                    "above": 30,
                }
            ],
        ),
        notification={
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.mobile_app_phone"]},
            "title": "",
            "message": "Message",
            "options": {},
        },
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()

    await hass.services.async_call("automation", "reload", blocking=True)
    hass.states.async_set("sensor.temperature", "31")
    await hass.async_block_till_done()
    assert delivered == snapshot


@pytest.mark.parametrize(
    "entity_ids",
    [
        ["sensor.first_dependency", "sensor.second_dependency"],
        ["sensor.repeated_dependency", "sensor.repeated_dependency"],
    ],
    ids=["distinct-entities", "repeated-state"],
)
async def test_configured_triggers_deliver_once_per_changed_entity(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    entity_ids,
    snapshot,
) -> None:
    """Distinct entities trigger independently; repeating an unchanged state does not."""

    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})
    for entity_id in set(entity_ids):
        hass.states.async_set(entity_id, "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[
                {"trigger": "state", "entity_id": entity_id}
                for entity_id in dict.fromkeys(entity_ids)
            ],
            conditions=[
                {
                    "condition": "or",
                    "conditions": [
                        {"condition": "state", "entity_id": entity_id, "state": "on"}
                        for entity_id in dict.fromkeys(entity_ids)
                    ],
                }
            ],
        ),
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    for entity_id in entity_ids:
        hass.states.async_set(entity_id, "on")
    await hass.async_block_till_done()

    assert len(delivered) == len(set(entity_ids))
    assert delivered == snapshot


@pytest.mark.parametrize("enabled", [True, False])
async def test_dispatcher_test_alert_runs_saved_actions_without_conditions(
    hass: HomeAssistant,
    full_feature_alert,
    automation_api,
    mock_register_panel,
    enabled: bool,
    snapshot,
) -> None:
    """Return before confirmation while preserving saved and runtime enablement."""

    full_feature_alert["enabled"] = enabled
    full_feature_alert["monitor"] = _monitor(
        triggers=[{"trigger": "state", "entity_id": "binary_sensor.door"}],
        conditions=[
            {
                "condition": "state",
                "entity_id": "binary_sensor.door",
                "state": "on",
            }
        ],
    )
    full_feature_alert["confirmation"]["notification"]["message"] = "Confirmed by {{confirmed_by}}"
    delivered: list[dict[str, object]] = []
    post_send_calls: list[dict[str, object]] = []
    confirmation_calls: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    async def handle_post_send(call) -> None:
        post_send_calls.append(dict(call.data))

    async def handle_confirmation_action(call) -> None:
        confirmation_calls.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    hass.services.async_register("logbook", "log", handle_post_send)
    hass.services.async_register("light", "turn_on", handle_confirmation_action)
    hass.states.async_set("binary_sensor.door", "off")
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [full_feature_alert]},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    main = next(
        state
        for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(full_feature_alert)
    )
    expected_state = "on" if enabled else "off"
    assert main.state == expected_state
    saved_config = dict(entry.options)

    await hass.services.async_call(
        "automation",
        "trigger",
        {"entity_id": main.entity_id, "skip_condition": False},
        blocking=True,
    )
    await hass.async_block_till_done()
    assert delivered == []

    async with asyncio.timeout(1):
        result = await WebsocketDispatcher().test_alert(
            hass,
            {"alert_id": full_feature_alert["id"]},
        )
    await _wait_for_history_events(
        entry.runtime_data,
        full_feature_alert["id"],
        "waiting",
    )
    assert len(delivered) == 1
    assert post_send_calls == []
    assert confirmation_calls == []
    assert hass.states.get(main.entity_id).attributes["current"] == 1
    assert hass.states.get(main.entity_id).state == expected_state

    hass.bus.async_fire(
        "mobile_app_notification_action",
        {"action": delivered[0]["data"]["actions"][0]["action"]},
    )
    await hass.async_block_till_done()
    assert len(delivered) == 2
    assert {
        "response": result,
        "notifications": delivered,
        "confirmation_actions": confirmation_calls,
    } == snapshot
    assert hass.states.get(main.entity_id).attributes["current"] == 0
    assert hass.states.get(main.entity_id).state == expected_state
    assert entry.options == saved_config
    assert entry.runtime_data.config["alerts"][0]["enabled"] is enabled
    history = await entry.runtime_data.history.async_entries(full_feature_alert["id"])
    assert sum(item["event"]["type"] == "confirmation_completed" for item in history) == 1


async def test_full_flow_uses_native_automation(
    hass: HomeAssistant,
    full_feature_alert,
    automation_api,
    mock_register_panel,
    snapshot,
) -> None:
    """Exercise validation, persistence, native execution, and reconciliation."""
    full_feature_alert["confirmation"]["notification"]["message"] = "Confirmed by {{confirmed_by}}"

    delivered: list[dict[str, object]] = []
    post_send_calls: list[dict[str, object]] = []
    confirmation_calls: list[dict[str, object]] = []
    confirmation_execution_order: list[str] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))
        confirmation_execution_order.append("notification")

    async def handle_post_send(call) -> None:
        post_send_calls.append(dict(call.data))

    async def handle_confirmation_action(call) -> None:
        confirmation_calls.append(dict(call.data))
        confirmation_execution_order.append("action")

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    hass.services.async_register("logbook", "log", handle_post_send)
    hass.services.async_register("light", "turn_on", handle_confirmation_action)
    hass.states.async_set("binary_sensor.door", "off")
    hass.states.async_set("binary_sensor.window", "off")
    hass.states.async_set("sensor.temperature", "20")
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})

    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()

    saved = await ha_notifications.async_save_config(
        hass,
        entry,
        {"version": 1, "alerts": [full_feature_alert]},
    )
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    assert saved["alerts"][0]["id"] == "full_feature"
    assert hass.states.get("automation.ha_notifications_full_feature") is not None
    document = automation_api.stored()
    assert [item["id"] for item in document] == [
        "ha_notifications_full_feature",
    ]

    delivered.clear()
    hass.states.async_set("binary_sensor.door", "on")
    await hass.async_block_till_done()
    assert delivered == []
    delivered.clear()

    hass.states.async_set("binary_sensor.window", "on")
    await asyncio.sleep(0)
    assert len(delivered) == 1

    confirmation_execution_order.clear()
    hass.bus.async_fire(
        "mobile_app_notification_action",
        {"action": "ha_notifications_full_feature_confirmation_confirm"},
    )
    await hass.async_block_till_done()
    assert confirmation_execution_order == ["notification", "action"]
    assert post_send_calls == []
    assert {
        "notifications": delivered,
        "confirmation_actions": confirmation_calls,
    } == snapshot
    history_entries = await entry.runtime_data.history.async_entries("full_feature")
    assert any(
        entry.get("event", {}).get("type") == "confirmation_completed" for entry in history_entries
    )
    completed_flow_ids = {
        item["event"]["flow_id"]
        for item in history_entries
        if item.get("event", {}).get("type") == "confirmation_completed"
    }
    assert len(completed_flow_ids) == 1
    completed_flow_id = completed_flow_ids.pop()
    completed_flow_events = {
        item["event"]["type"]
        for item in history_entries
        if item.get("event", {}).get("flow_id") == completed_flow_id
    }
    assert {
        "notification_sent",
        "waiting",
        "confirmation_completed",
        "action_executed",
    } <= completed_flow_events
    completion_index = next(
        index
        for index, item in enumerate(history_entries)
        if item.get("event", {}).get("flow_id") == completed_flow_id
        and item["event"]["type"] == "confirmation_completed"
    )
    notification_index = next(
        index
        for index, item in enumerate(history_entries)
        if item.get("event", {}).get("flow_id") == completed_flow_id
        and item["event"]["type"] == "notification_sent"
        and item["event"].get("details", {}).get("reason") == "confirmation_notification"
    )
    action_executed_index = next(
        index
        for index, item in enumerate(history_entries)
        if item.get("event", {}).get("flow_id") == completed_flow_id
        and item["event"]["type"] == "action_executed"
        and item["event"].get("details", {}).get("action") == "light.turn_on"
    )
    assert action_executed_index < notification_index
    assert notification_index < completion_index
    follow_up_event = history_entries[notification_index]["event"]
    assert follow_up_event["details"]["reason"] == "confirmation_notification"

    updated = {**full_feature_alert, "name": "Updated full feature"}
    await ha_notifications.async_save_config(
        hass,
        entry,
        {"version": 1, "alerts": [updated]},
    )
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    document = automation_api.stored()
    assert document[0]["id"] == "ha_notifications_full_feature"
    assert document[0]["alias"] == "HA Notifications: Updated full feature"

    await ha_notifications.async_save_config(
        hass,
        entry,
        {"version": 1, "alerts": []},
    )
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    document = automation_api.stored()
    assert document == []


async def test_last_parallel_run_stopping_does_not_emit_inactive_or_clear(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    snapshot,
) -> None:
    """Stopping parallel runs never emits the removed event or clears notifications."""

    delivered: list[dict[str, object]] = []
    commands = []
    inactive_events = []
    hass.bus.async_listen(
        "ha_notifications_inactive", callback(lambda event: inactive_events.append(event))
    )
    hass.bus.async_listen(
        "ha_notifications_command", callback(lambda event: commands.append(event))
    )

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    hass.states.async_set("binary_sensor.second_trigger", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[
                {"trigger": "state", "entity_id": "input_boolean.alert_button", "to": "on"},
                {"trigger": "state", "entity_id": "binary_sensor.second_trigger", "to": "on"},
            ],
            conditions=[
                {
                    "condition": "state",
                    "entity_id": "input_boolean.alert_button",
                    "state": "on",
                }
            ],
        ),
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "reminders": {"enabled": False, "interval": 60},
        },
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    hass.states.async_set("input_boolean.alert_button", "on")
    await _wait_for_history_events(entry.runtime_data, alert["id"], "waiting")
    hass.states.async_set("binary_sensor.second_trigger", "on")
    await _wait_for_history_events(entry.runtime_data, alert["id"], "waiting", 2)

    entries = await entry.runtime_data.history.async_entries(alert["id"])
    assert sum(item["event"]["type"] == "waiting" for item in entries) == 2
    assert len(delivered) == 2

    hass.states.async_set("input_boolean.alert_button", "off")

    main = next(
        state
        for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(alert)
    )
    assert main.attributes["current"] == 2
    assert inactive_events == []
    await hass.services.async_call(
        "automation",
        "turn_off",
        {"entity_id": main.entity_id, "stop_actions": True},
        blocking=True,
    )
    await hass.async_block_till_done()
    entries = await entry.runtime_data.history.async_entries(alert["id"])
    assert inactive_events == []
    assert commands == []
    assert len(delivered) == 2
    assert all(item["message"] != "clear_notification" for item in delivered)
    assert hass.states.get(main.entity_id).attributes["current"] == 0
    assert not any(item["event"]["type"] == "inactive" for item in entries)
    assert not any(item["event"]["type"] == "confirmation_timeout" for item in entries)
    assert {
        "notifications": delivered,
        "history_events": [item["event"]["type"] for item in entries],
    } == snapshot


@pytest.mark.parametrize(
    "inactive_enabled,has_items,clear_notification",
    [
        (True, True, False),
        (True, True, True),
        (False, True, True),
        (True, False, True),
        (False, False, False),
    ],
)
async def test_explicit_door_close_uses_shared_trigger_without_stopping_parallel_flows(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    inactive_enabled: bool,
    has_items: bool,
    clear_notification: bool,
    snapshot,
) -> None:
    """Configured inactive triggers clear state without stopping active flows."""

    delivered: list[dict[str, object]] = []
    commands = []
    hass.bus.async_listen(
        "ha_notifications_command", callback(lambda event: commands.append(event))
    )

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})
    hass.states.async_set("binary_sensor.door", "on")
    hass.states.async_set("binary_sensor.guard", "on")
    hass.states.async_set("input_boolean.alert_button", "off")
    hass.states.async_set("binary_sensor.second_trigger", "off")
    active_triggers = [
        {"trigger": "state", "entity_id": "input_boolean.alert_button", "to": "on", "id": "open"},
        {
            "trigger": "state",
            "entity_id": "binary_sensor.second_trigger",
            "to": "on",
            "id": "second",
        },
    ]
    inactive_trigger = {
        "trigger": "state",
        "entity_id": "binary_sensor.door",
        "from": "on",
        "to": "off",
        "id": "door_closed",
    }
    monitor = _monitor(
        triggers=active_triggers,
        conditions=[
            {
                "condition": "state",
                "entity_id": "binary_sensor.door",
                "state": "on",
            },
            {
                "condition": "state",
                "entity_id": "binary_sensor.guard",
                "state": "on",
            },
        ],
    )
    monitor["inactive"] = {
        "enabled": inactive_enabled,
        "items": [inactive_trigger] if has_items else [],
        "clear_notification": clear_notification,
    }
    alert = alert_factory(
        "base",
        monitor=monitor,
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "reminders": {"enabled": False, "interval": 60},
        },
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    generated = automation_api.stored()
    has_handler = inactive_enabled and has_items
    assert len(generated) == 1
    active_automation = generated[0]
    assert active_automation["id"] == automation_id(alert)
    assert active_automation["triggers"] == snapshot(name="native-triggers")
    main = next(
        state
        for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(alert)
    )
    assert not any(
        state.attributes.get("id") == f"{automation_id(alert)}_inactive"
        for state in hass.states.async_all("automation")
    )
    for count, entity_id in enumerate(
        ("input_boolean.alert_button", "binary_sensor.second_trigger"), start=1
    ):
        hass.states.async_set(entity_id, "on")
        await _wait_for_history_events(entry.runtime_data, alert["id"], "waiting", count)
    entries = await entry.runtime_data.history.async_entries(alert["id"])
    waiting_flows = {
        item["event"]["flow_id"] for item in entries if item["event"]["type"] == "waiting"
    }
    assert len(waiting_flows) == 2
    assert len(delivered) == 2
    assert hass.states.get(main.entity_id).attributes["current"] == 2

    guard_changed = asyncio.Event()
    door_closed = asyncio.Event()

    @callback
    def state_changed(event) -> None:
        if event.data["entity_id"] == "binary_sensor.guard":
            guard_changed.set()
        elif event.data["entity_id"] == "binary_sensor.door":
            door_closed.set()

    remove_listener = hass.bus.async_listen("state_changed", state_changed)
    hass.states.async_set("binary_sensor.guard", "off")
    async with asyncio.timeout(5):
        await guard_changed.wait()
    assert hass.states.get(main.entity_id).attributes["current"] == 2
    assert commands == []
    assert not any(
        item["event"]["type"] == "inactive"
        for item in await entry.runtime_data.history.async_entries(alert["id"])
    )

    hass.states.async_set("binary_sensor.door", "off")
    async with asyncio.timeout(5):
        await door_closed.wait()
    remove_listener()
    if has_handler:
        await _wait_for_history_events(entry.runtime_data, alert["id"], "inactive")
    entries = await entry.runtime_data.history.async_entries(alert["id"])
    if has_handler:
        assert commands == []
        assert hass.states.get(main.entity_id).attributes["current"] == 2
        inactive = [item for item in entries if item["event"]["type"] == "inactive"]
        assert len(inactive) == 1
        assert inactive[0]["event"]["flow_id"] not in waiting_flows
        assert all(item["event"]["details"]["action"] == "inactive_trigger" for item in inactive)
        assert hass.states.get(main.entity_id).state == "on"
    else:
        assert commands == []
        assert hass.states.get(main.entity_id).attributes["current"] == 2
        assert not any(item["event"]["type"] in {"inactive", "cancelled"} for item in entries)
    cleared = has_handler and clear_notification
    assert len(delivered) == (3 if cleared else 2)
    assert delivered == snapshot(name="notifications")
    cleared_events = [item for item in entries if item["event"]["type"] == "notification_cleared"]
    assert len(cleared_events) == int(cleared)
    assert all(item["event"]["flow_id"] not in waiting_flows for item in cleared_events)
    assert not any(
        item["event"]["type"] in {"confirmation_completed", "confirmation_timeout"}
        for item in entries
    )
    await hass.services.async_call(
        "automation",
        "turn_off",
        {"entity_id": main.entity_id, "stop_actions": True},
        blocking=True,
    )


async def test_confirmation_finishing_does_not_emit_inactive_or_clear(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    snapshot,
) -> None:
    """Confirmation finishes a single main run without automatic notification clearing."""

    delivered: list[dict[str, object]] = []
    commands = []
    inactive_events = []
    hass.bus.async_listen(
        "ha_notifications_inactive", callback(lambda event: inactive_events.append(event))
    )

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    hass.bus.async_listen(
        "ha_notifications_command", callback(lambda event: commands.append(event))
    )
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            startup=True,
            triggers=[{"trigger": "state", "entity_id": "input_boolean.alert_button", "to": "on"}],
        ),
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "reminders": {
                "enabled": False,
                "interval": 60,
            },
        },
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    generated = automation_api.stored()
    assert len(generated) == 1
    assert generated[0]["triggers"] == snapshot(name="native-triggers")

    hass.states.async_set("input_boolean.alert_button", "on")
    await _wait_for_history_events(entry.runtime_data, alert["id"], "waiting")
    entries = await entry.runtime_data.history.async_entries(alert["id"])
    waiting = next(item for item in entries if item["event"]["type"] == "waiting")
    waiting_flow_id = waiting["event"]["flow_id"]
    started = next(item for item in entries if item["event"]["type"] == "started")
    started_by = started["event"]["details"]["started_by"]
    assert started_by == snapshot(name="trigger-context")
    assert len(delivered) == 1

    hass.states.async_set("input_boolean.alert_button", "off")
    assert inactive_events == []
    assert len(delivered) == 1
    hass.bus.async_fire(
        "mobile_app_notification_action",
        {
            "action": delivered[0]["data"]["actions"][0]["action"],
        },
    )
    await hass.async_block_till_done()

    entries = await entry.runtime_data.history.async_entries(alert["id"])
    assert inactive_events == []
    assert commands == []
    assert any(
        item["event"]["type"] == "confirmation_completed"
        and item["event"].get("flow_id") == waiting_flow_id
        for item in entries
    ), entries
    assert len(delivered) == 1
    assert delivered[0]["message"] != "clear_notification"
    assert not any(item["event"]["type"] == "inactive" for item in entries)
    main = next(
        state
        for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(alert)
    )
    assert main.attributes["current"] == 0
    assert not any(
        item["event"]["type"]
        in {"confirmation_timeout", "confirmation_resumed", "automation_completed"}
        for item in entries
    )
    assert {
        "notifications": delivered,
        "history_events": [item["event"]["type"] for item in entries],
    } == snapshot(name="completed-run")


@pytest.mark.parametrize("operation", ["update", "delete", "unchanged"])
async def test_saving_alert_cancels_only_changed_active_runs(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    operation,
) -> None:
    """Cancel changed/deleted runs before removing their config, not in the API client."""

    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[{"trigger": "state", "entity_id": "input_boolean.alert_button", "to": "on"}],
            conditions=[
                {
                    "condition": "state",
                    "entity_id": "input_boolean.alert_button",
                    "state": "on",
                }
            ],
        ),
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "reminders": {"enabled": False, "interval": 60},
        },
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    hass.states.async_set("input_boolean.alert_button", "on")
    await _wait_for_history_events(entry.runtime_data, alert["id"], "waiting")

    waiting = next(
        item
        for item in await entry.runtime_data.history.async_entries(alert["id"])
        if item["event"]["type"] == "waiting"
    )
    flow_id = waiting["event"]["flow_id"]
    automation = next(
        state
        for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(alert)
    )
    assert automation.attributes["current"] == 1

    updated_alert = {**alert, "name": "Updated alert"} if operation == "update" else alert
    await ha_notifications.async_save_config(
        hass,
        entry,
        {"version": 1, "alerts": [] if operation == "delete" else [updated_alert]},
    )
    if operation == "unchanged":
        assert hass.states.get(automation.entity_id).attributes["current"] == 1
        await WebsocketDispatcher().cancel_run(hass, {"alert_id": alert["id"]})
        return
    await hass.async_block_till_done()

    automation = hass.states.get(automation.entity_id)
    assert automation.state == "on"
    assert automation.attributes["current"] == 0
    run_events = [
        item["event"]
        for item in await entry.runtime_data.history.async_entries(alert["id"])
        if item["event"].get("flow_id") == flow_id
    ]
    assert run_events[0]["type"] == "cancelled"
    assert run_events[0]["details"]["action"] in {
        "confirmation_cancelled",
        "automation_cancelled",
    }


async def test_active_trigger_with_false_conditions_is_ignored(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
) -> None:
    """An active trigger whose configured conditions fail does not start a flow."""

    delivered: list[dict[str, object]] = []
    commands = []
    inactive_events = []
    hass.bus.async_listen(
        "ha_notifications_command", callback(lambda event: commands.append(event))
    )
    hass.bus.async_listen(
        "ha_notifications_inactive", callback(lambda event: inactive_events.append(event))
    )

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    hass.states.async_set("binary_sensor.alert_guard", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[
                {"trigger": "state", "entity_id": "input_boolean.alert_button", "to": "on"},
                {"trigger": "state", "entity_id": "binary_sensor.alert_guard"},
            ],
            conditions=[
                {
                    "condition": "state",
                    "entity_id": "binary_sensor.alert_guard",
                    "state": "on",
                }
            ],
        ),
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "reminders": {"enabled": False, "interval": 60},
        },
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    hass.states.async_set("input_boolean.alert_button", "on")
    await hass.async_block_till_done()
    entries = await entry.runtime_data.history.async_entries(alert["id"])
    assert commands == []
    assert inactive_events == []
    assert delivered == []
    assert not any(item["event"]["type"] in {"started", "waiting", "inactive"} for item in entries)
    main_automation = next(
        state
        for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(alert)
    )
    assert main_automation.attributes["current"] == 0


@pytest.mark.parametrize("show_attempts", [False, True], ids=["plain", "attempts"])
@pytest.mark.parametrize("title", ["", "Original title"], ids=["empty_title", "original_title"])
async def test_confirmation_timeout_retries_are_bounded_without_follow_ups(
    hass: HomeAssistant,
    alert_factory,
    automation_api,
    mock_register_panel,
    show_attempts: bool,
    title: str,
    freezer,
    snapshot,
) -> None:
    """Timeouts repeat reminders finitely and skip response-only actions."""
    start = (datetime.now(UTC) + timedelta(seconds=1)).replace(microsecond=0)
    freezer.move_to(start)

    delivered: list[dict[str, object]] = []
    follow_up_delivered: list[dict[str, object]] = []
    post_send_calls: list[dict[str, object]] = []
    confirmation_calls: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    async def handle_follow_up_notification(call) -> None:
        follow_up_delivered.append(dict(call.data))

    async def handle_post_send(call) -> None:
        post_send_calls.append(dict(call.data))

    async def handle_confirmation_action(call) -> None:
        confirmation_calls.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    hass.services.async_register("notify", "mobile_app_follow_up", handle_follow_up_notification)
    hass.services.async_register("logbook", "log", handle_post_send)
    hass.services.async_register("light", "turn_on", handle_confirmation_action)
    automation_api.prepare()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("binary_sensor.confirmation", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[{"trigger": "state", "entity_id": "binary_sensor.confirmation"}],
            conditions=[
                {
                    "condition": "state",
                    "entity_id": "binary_sensor.confirmation",
                    "state": "on",
                }
            ],
        ),
        notification={
            "action": "notify.mobile_app_phone",
            "title": title,
            "message": "Original main message",
            "options": {},
        },
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "reminders": {
                "enabled": True,
                "interval": 10,
                "max_attempts": 2,
                "show_attempts": show_attempts,
            },
            "notification": {
                "enabled": True,
                "action": "notify.mobile_app_follow_up",
                "title": "Follow-up title",
                "message": "Follow-up message",
                "options": {},
            },
            "actions": {"enabled": True, "items": [{"action": "light.turn_on"}]},
        },
        post_send_actions={
            "enabled": True,
            "items": [{"action": "logbook.log", "data": {"name": "sent"}}],
        },
    )
    entry = MockConfigEntry(
        version=CONFIG_ENTRY_VERSION,
        minor_version=CONFIG_ENTRY_MINOR_VERSION,
        domain=DOMAIN,
        title="HA Notifications",
        options={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await automation_api.sync_entry(entry)
    await hass.async_block_till_done()
    hass.states.async_set("binary_sensor.confirmation", "on")
    await _wait_for_history_events(entry.runtime_data, "base_alert", "waiting")
    assert len(delivered) == 1
    async_fire_time_changed(hass, start + timedelta(seconds=9))
    assert len(delivered) == 1
    for seconds, expected_count in ((10, 2), (20, 3), (30, 3), (60, 3)):
        future = start + timedelta(seconds=seconds)
        async_fire_time_changed(hass, future)
        freezer.move_to(future)
        await _wait_for_history_events(
            entry.runtime_data,
            "base_alert",
            "waiting" if seconds < 30 else "confirmation_timeout",
            expected_count if seconds < 30 else 1,
        )
        assert len(delivered) == expected_count
    await hass.async_block_till_done()

    assert follow_up_delivered == []
    assert confirmation_calls == []
    history_entries = await entry.runtime_data.history.async_entries("base_alert")
    event_types = [item.get("event", {}).get("type") for item in history_entries]
    assert "confirmation_timeout" in event_types
    assert "confirmation_completed" not in event_types
    assert "confirmation_resumed" not in event_types
    assert "automation_completed" not in event_types
    assert {
        "notifications": delivered,
        "post_send_actions": post_send_calls,
        "history_events": event_types,
    } == snapshot
