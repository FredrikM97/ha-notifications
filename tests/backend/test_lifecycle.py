"""Tests for the Home Assistant Notifications config-entry lifecycle."""

from __future__ import annotations

import asyncio
import logging

import pytest
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import category_registry as cr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import label_registry as lr
from homeassistant.setup import async_setup_component

from custom_components import ha_notifications
from custom_components.ha_notifications.automation import automation_id
from custom_components.ha_notifications.const import (
    AUTOMATION_CATEGORY,
    AUTOMATION_CATEGORY_SCOPE,
    AUTOMATION_LABEL,
    DOMAIN,
)
from custom_components.ha_notifications.domain import RuntimeData
from tests.backend.conftest import MockConfigEntry


def _monitor(
    *,
    triggers: list[dict[str, object]] | None = None,
    conditions: list[dict[str, object]] | None = None,
    startup: bool = False,
    periodic: bool = False,
    interval: int = 43200,
    automation_mode: str = "parallel",
) -> dict[str, object]:
    return {
        "automation_mode": automation_mode,
        "inactive": {"enabled": False, "items": [], "clear_notification": False},
        "triggers": {
            "enabled": True,
            "items": triggers or [],
        },
        "conditions": {
            "enabled": True,
            "items": conditions or [],
            "startup": startup,
            "periodic": periodic,
            "interval": interval,
        },
    }


async def _wait_for_history_events(
    runtime: RuntimeData, alert_id: str, event_type: str, count: int = 1,
) -> None:
    async with asyncio.timeout(5):
        while sum(
            item["event"]["type"] == event_type
            for item in await runtime.history.async_entries(alert_id)
        ) < count:
            await asyncio.sleep(0)


async def test_invalid_config_entry_still_loads_panel(
    hass: HomeAssistant,
    monkeypatch,
    enable_custom_integrations,
) -> None:
    """Keep the recovery editor available when persisted config is invalid."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={
            "version": 1,
            "alerts": [{
                "id": "door",
                "triggers": [],
            }],
        },
        )

    assert await ha_notifications.async_setup_entry(hass, entry)
    assert getattr(entry, "runtime_data", None) is None


async def test_config_entry_update_reload_and_unload_are_reconciled(
    hass: HomeAssistant,
    monkeypatch,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    caplog,
) -> None:
    """Reconcile lifecycle changes in the dedicated automation file."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)

    reload_count = 0

    async def reload_automations(_call) -> None:
        nonlocal reload_count
        reload_count += 1

    hass.services.async_register("automation", "reload", reload_automations)
    alert = alert_factory("base")
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    caplog.set_level(
        logging.DEBUG,
        logger="custom_components.ha_notifications.automation_runtime",
    )
    mock_automation_files["prepare"](include=False)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    assert reload_count == 1
    assert "Reloaded 1 generated automation(s)" in caplog.text

    await ha_notifications.async_reconcile_automations(
        hass,
        entry.runtime_data.config["alerts"],
    )
    assert reload_count == 1
    assert "Generated automations are unchanged; skipping reload" in caplog.text

    document = mock_automation_files["read_automations"]()
    assert document[0]["id"] == "ha_notifications_base_alert"
    assert hass.services.has_service(DOMAIN, "send")
    assert hass.services.has_service(DOMAIN, "clear")

    updated = alert_factory("base")
    updated["name"] = "Updated alert"
    hass.config_entries.async_update_entry(
        entry,
        options={"version": 1, "alerts": [updated]},
    )
    await hass.async_block_till_done()
    assert reload_count == 2

    document = mock_automation_files["read_automations"]()
    assert document[0]["alias"] == "HA Notifications: Updated alert"

    assert await ha_notifications.async_unload_entry(hass, entry)
    await hass.async_block_till_done()
    assert reload_count == 3

    document = mock_automation_files["read_automations"]()
    assert document == []
    assert not hass.services.has_service(DOMAIN, "send")
    assert not hass.services.has_service(DOMAIN, "clear")
    assert await ha_notifications.async_unload_entry(hass, entry)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    assert reload_count == 4
    document = mock_automation_files["read_automations"]()
    assert [item["id"] for item in document] == ["ha_notifications_base_alert"]


async def test_config_entry_update_targets_changed_and_deleted_alerts(
    hass: HomeAssistant,
    monkeypatch,
    alert_factory,
    enable_custom_integrations,
) -> None:
    """Regenerate the complete automation document on configuration updates."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    reconciliations: list[set[str] | None] = []

    async def reconcile(_hass, _alerts, affected_ids=None) -> None:
        reconciliations.append(affected_ids)

    monkeypatch.setattr(ha_notifications, "async_reconcile_automations", reconcile)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={
            "version": 1,
            "alerts": [alert_factory("base"), alert_factory("persisted")],
        },
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    reconciliations.clear()

    updated = alert_factory("base")
    updated["name"] = "Updated alert"
    hass.config_entries.async_update_entry(
        entry,
        options={"version": 1, "alerts": [updated]},
    )
    await hass.async_block_till_done()

    assert reconciliations == [None]


async def test_async_save_config_rolls_back_entry_and_runtime_on_failure(
    hass: HomeAssistant,
    monkeypatch,
    alert_factory,
    enable_custom_integrations,
) -> None:
    """Restore the previous config when automation reconciliation fails."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    hass.services.async_register("automation", "reload", lambda _call: None)
    alert = alert_factory("base")
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    previous = entry.runtime_data.config
    entry.runtime_data.remove_update_listener()

    async def fail_reconcile(*_args, **_kwargs) -> None:
        raise RuntimeError("reload failed")

    monkeypatch.setattr(ha_notifications, "async_reconcile_automations", fail_reconcile)
    updated = alert_factory("base")
    updated["name"] = "Updated alert"

    with pytest.raises(RuntimeError, match="reload failed"):
        await ha_notifications.async_save_config(
            hass,
            entry,
            {"version": 1, "alerts": [updated]},
        )

    assert entry.options == previous
    assert isinstance(entry.runtime_data, RuntimeData)
    assert entry.runtime_data.config == previous


@pytest.mark.parametrize(
    ("condition_state", "skip_condition", "should_deliver"),
    [("on", False, True), ("off", False, False), ("off", True, True)],
)
async def test_generated_automation_executes_lifecycle_delivery(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
    condition_state: str,
    skip_condition: bool,
    should_deliver: bool,
) -> None:
    """Respect conditions unless an explicit manual trigger bypasses them."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    hass.states.async_set("binary_sensor.door", condition_state)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})
    alert = alert_factory(
        "base",
        monitor=_monitor(startup=True, conditions=[{
            "condition": "state",
            "entity_id": "binary_sensor.door",
            "state": "on",
        }]),
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    assert hass.states.get("automation.ha_notifications_test_alert") is not None
    automation_registry = er.async_get(hass)
    generated_entity = automation_registry.async_get(
        "automation.ha_notifications_test_alert"
    )
    category = next(
        item
        for item in cr.async_get(hass).async_list_categories(
            scope=AUTOMATION_CATEGORY_SCOPE,
        )
        if item.name == AUTOMATION_CATEGORY
    )
    assert generated_entity is not None
    assert generated_entity.hidden_by is er.RegistryEntryHider.INTEGRATION
    assert generated_entity.categories[AUTOMATION_CATEGORY_SCOPE] == category.category_id
    label = lr.async_get(hass).async_get_label_by_name(AUTOMATION_LABEL)
    assert label is not None and label.label_id in generated_entity.labels

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

    expected = [{"message": "Message", "data": {"tag": "base_alert"}}]
    assert delivered == (expected if should_deliver else [])


async def test_generated_automation_reports_inactive_without_clearing(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Execute an inactive detector without clearing prior notifications."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("binary_sensor.door", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            conditions=[{
                "condition": "state",
                "entity_id": "binary_sensor.door",
                "state": "on",
            }],
            triggers=[
            {"trigger": "state", "entity_id": "binary_sensor.door"},
            {"trigger": "homeassistant", "event": "start"},
            ],
        ),
        notification={
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.mobile_app_phone"]},
            "data": {"message": "Door open"},
        },
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()

    hass.bus.async_fire(EVENT_HOMEASSISTANT_STARTED)
    await hass.async_block_till_done()
    history = await entry.runtime_data.history.async_entries("base_alert")
    assert [item["event"]["type"] for item in history] == ["inactive"]

    hass.states.async_set("binary_sensor.door", "on")
    await hass.async_block_till_done()
    hass.states.async_set("binary_sensor.door", "off")
    await hass.async_block_till_done()

    assert delivered == [{"message": "Door open", "data": {"tag": "base_alert"}}]
    history = await entry.runtime_data.history.async_entries("base_alert")
    assert [item["event"]["type"] for item in history] == [
        "inactive",
        "completed",
        "notification_sent",
        "started",
        "inactive",
    ]


async def test_generated_automation_executes_startup_trigger(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Execute a generated automation from the Home Assistant start event."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})
    alert = alert_factory(
        "base",
        monitor=_monitor(startup=True),
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    hass.bus.async_fire(EVENT_HOMEASSISTANT_STARTED)
    await hass.async_block_till_done()

    assert delivered == [
        {"message": "Message", "data": {"tag": "base_alert"}}
    ]


async def test_generated_automation_executes_interval_trigger(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Execute a generated automation from a time-pattern trigger."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})
    alert = alert_factory(
        "base",
        monitor=_monitor(periodic=True, interval=1),
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    delivered.clear()
    # The real time_pattern trigger fires on the next whole second.
    async with asyncio.timeout(5):
        while not delivered:
            await asyncio.sleep(0.05)
    await hass.async_block_till_done()
    await ha_notifications.async_unload_entry(hass, entry)
    await hass.async_block_till_done()

    assert delivered == [
        {"message": "Message", "data": {"tag": "base_alert"}}
    ]


async def test_generated_native_for_trigger_uses_ha_clock_across_reload(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Use native HA timing across an automation reload."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})
    hass.states.async_set("sensor.temperature", "20")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[{"trigger": "state", "entity_id": "sensor.temperature"}],
            conditions=[{
                "condition": "numeric_state",
                "entity_id": "sensor.temperature",
                "above": 30,
            }],
        ),
        notification={
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.mobile_app_phone"]},
            "data": {"message": "Message"},
        },
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()

    await hass.services.async_call("automation", "reload", blocking=True)
    hass.states.async_set("sensor.temperature", "31")
    await hass.async_block_till_done()
    assert delivered == [{"message": "Message", "data": {"tag": "base_alert"}}]


async def test_configured_triggers_run_with_multiple_condition_entities(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Configured triggers evaluate the native multi-entity condition."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})
    hass.states.async_set("sensor.first_dependency", "off")
    hass.states.async_set("sensor.second_dependency", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[
                {"trigger": "state", "entity_id": "sensor.first_dependency"},
                {"trigger": "state", "entity_id": "sensor.second_dependency"},
            ],
            conditions=[{
                "condition": "or",
                "conditions": [
                    {
                        "condition": "state",
                        "entity_id": "sensor.first_dependency",
                        "state": "on",
                    },
                    {
                        "condition": "state",
                        "entity_id": "sensor.second_dependency",
                        "state": "on",
                    },
                ],
            }],
        ),
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    hass.states.async_set("sensor.first_dependency", "on")
    hass.states.async_set("sensor.second_dependency", "on")
    await hass.async_block_till_done()

    assert delivered == [
        {"message": "Message", "data": {"tag": "base_alert"}},
        {"message": "Message", "data": {"tag": "base_alert"}},
    ]


async def test_generated_automation_deduplicates_repeated_condition_entities(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Do not deliver twice for duplicate condition entities or same state."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})
    hass.states.async_set("sensor.repeated_dependency", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[{
                "trigger": "state",
                "entity_id": "sensor.repeated_dependency",
            }],
            conditions=[{
                "condition": "state",
                "entity_id": "sensor.repeated_dependency",
                "state": "on",
            }],
        ),
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    hass.states.async_set("sensor.repeated_dependency", "on")
    hass.states.async_set("sensor.repeated_dependency", "on")
    await hass.async_block_till_done()

    assert delivered == [
        {"message": "Message", "data": {"tag": "base_alert"}}
    ]


async def test_full_flow_uses_native_automation(
    hass: HomeAssistant,
    full_feature_alert,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Exercise validation, persistence, native execution, and reconciliation."""
    full_feature_alert["confirmation"]["notification"]["data"][
        "message"
    ] = "Confirmed by {{confirmed_by}}"

    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
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
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})

    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": []},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()

    saved = await ha_notifications.async_save_config(
        hass,
        entry,
        {"version": 1, "alerts": [full_feature_alert]},
    )
    await hass.async_block_till_done()
    assert saved["alerts"][0]["id"] == "full_feature"
    assert hass.states.get("automation.ha_notifications_full_feature") is not None
    document = mock_automation_files["read_automations"]()
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
    assert delivered == [{
        "message": "Door open",
        "data": {"tag": "full_feature", "actions": [{
            "action": "ha_notifications_full_feature_confirmation_confirm",
            "title": "Confirm",
        }]},
    }]

    confirmation_execution_order.clear()
    hass.bus.async_fire(
        "mobile_app_notification_action",
        {"action": "ha_notifications_full_feature_confirmation_confirm"},
    )
    await hass.async_block_till_done()
    assert confirmation_execution_order == ["notification", "action"]
    assert delivered[-1] == {
        "message": "Confirmed by Unknown device",
        "data": {"tag": "full_feature"},
    }
    assert post_send_calls == [{"name": "Full feature sent"}]
    assert confirmation_calls == [{"entity_id": ["light.hall"]}]
    history_entries = await entry.runtime_data.history.async_entries("full_feature")
    assert any(
        entry.get("event", {}).get("type") == "confirmation_completed"
        for entry in history_entries
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
        and item["event"].get("details", {}).get("reason")
        == "confirmation_notification"
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
    await hass.async_block_till_done()
    document = mock_automation_files["read_automations"]()
    assert document[0]["id"] == "ha_notifications_full_feature"
    assert document[0]["alias"] == "HA Notifications: Updated full feature"

    await ha_notifications.async_save_config(
        hass,
        entry,
        {"version": 1, "alerts": []},
    )
    await hass.async_block_till_done()
    document = mock_automation_files["read_automations"]()
    assert document == []


async def test_confirmation_response_completes_without_follow_ups(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """A matching mobile action is the sole terminal confirmation outcome."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("binary_sensor.confirmation", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[{"trigger": "state", "entity_id": "binary_sensor.confirmation"}],
            conditions=[{
                "condition": "state",
                "entity_id": "binary_sensor.confirmation",
                "state": "on",
            }],
        ),
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "actions": [],
            "reminders": {"enabled": False, "interval": 60},
        },
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    hass.states.async_set("binary_sensor.confirmation", "on")
    await asyncio.sleep(0)

    action = delivered[0]["data"]["actions"][0]["action"]
    hass.bus.async_fire(
        "mobile_app_notification_action",
        {"action": action},
    )
    await hass.async_block_till_done()

    history_entries = await entry.runtime_data.history.async_entries(alert["id"])
    event_types = [item.get("event", {}).get("type") for item in history_entries]
    assert "confirmation_completed" in event_types
    assert "confirmation_timeout" not in event_types
    assert "confirmation_resumed" not in event_types
    assert "automation_completed" not in event_types


async def test_last_parallel_run_stopping_does_not_emit_inactive_or_clear(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Stopping parallel runs never emits the removed event or clears notifications."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []
    commands = []
    inactive_events = []
    hass.bus.async_listen("ha_notifications_inactive", callback(lambda event: inactive_events.append(event)))
    hass.bus.async_listen("ha_notifications_command", callback(lambda event: commands.append(event)))

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    hass.states.async_set("binary_sensor.second_trigger", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            automation_mode="parallel",
            triggers=[
                {"trigger": "state", "entity_id": "input_boolean.alert_button", "to": "on"},
                {"trigger": "state", "entity_id": "binary_sensor.second_trigger", "to": "on"},
            ],
            conditions=[{
                "condition": "state",
                "entity_id": "input_boolean.alert_button",
                "state": "on",
            }],
        ),
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "actions": [],
            "reminders": {"enabled": False, "interval": 60},
        },
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
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
        state for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(alert)
    )
    assert main.attributes["current"] == 2
    assert inactive_events == []
    await hass.services.async_call(
        "automation", "turn_off",
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
    assert not any(
        item["event"]["type"] == "confirmation_timeout"
        for item in entries
    )


@pytest.mark.parametrize(
    "inactive_enabled,has_items,clear_notification",
    [(True, True, False), (True, True, True), (False, True, True), (True, False, True), (False, False, False)],
)
async def test_explicit_door_close_inactive_trigger_cancels_parallel_waits(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
    inactive_enabled: bool,
    has_items: bool,
    clear_notification: bool,
) -> None:
    """Only configured inactive triggers cancel waits, independently of conditions."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []
    commands = []
    hass.bus.async_listen("ha_notifications_command", callback(lambda event: commands.append(event)))

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})
    hass.states.async_set("binary_sensor.door", "on")
    hass.states.async_set("binary_sensor.guard", "on")
    hass.states.async_set("input_boolean.alert_button", "off")
    hass.states.async_set("binary_sensor.second_trigger", "off")
    active_triggers = [
        {"trigger": "state", "entity_id": "input_boolean.alert_button", "to": "on", "id": "open"},
        {"trigger": "state", "entity_id": "binary_sensor.second_trigger", "to": "on", "id": "second"},
    ]
    inactive_trigger = {
        "trigger": "state", "entity_id": "binary_sensor.door",
        "from": "on", "to": "off", "id": "door_closed",
    }
    monitor = _monitor(
        triggers=active_triggers,
        conditions=[{
            "condition": "state", "entity_id": "binary_sensor.door", "state": "on",
        }, {
            "condition": "state", "entity_id": "binary_sensor.guard", "state": "on",
        }],
        automation_mode="parallel",
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
            "actions": [],
            "reminders": {"enabled": False, "interval": 60},
        },
    )
    entry = MockConfigEntry(
        domain=DOMAIN, title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)
    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    generated = mock_automation_files["read_automations"]()
    has_handler = inactive_enabled and has_items
    assert len(generated) == (2 if has_handler else 1)
    assert generated[0]["triggers"] == active_triggers
    if has_handler:
        assert generated[1]["triggers"] == [inactive_trigger]
        assert generated[1]["conditions"] == []
    main = next(
        state for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(alert)
    )
    companions = [
        state for state in hass.states.async_all("automation")
        if state.attributes.get("id") == f"{automation_id(alert)}_inactive"
    ]
    assert len(companions) == int(has_handler)
    for count, entity_id in enumerate(("input_boolean.alert_button", "binary_sensor.second_trigger"), start=1):
        hass.states.async_set(entity_id, "on")
        await _wait_for_history_events(entry.runtime_data, alert["id"], "waiting", count)
    entries = await entry.runtime_data.history.async_entries(alert["id"])
    waiting_flows = {
        item["event"]["flow_id"] for item in entries
        if item["event"]["type"] == "waiting"
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
        await _wait_for_history_events(entry.runtime_data, alert["id"], "cancelled", 2)
        await hass.async_block_till_done()
    entries = await entry.runtime_data.history.async_entries(alert["id"])
    if has_handler:
        assert [event.data for event in commands] == [{"alert_id": alert["id"], "command": "cancel_run"}]
        assert hass.states.get(main.entity_id).attributes["current"] == 0
        cancelled_flows = {
            item["event"]["flow_id"] for item in entries
            if item["event"]["type"] == "cancelled"
        }
        assert cancelled_flows == waiting_flows
        inactive = [item for item in entries if item["event"]["type"] == "inactive"]
        assert len(inactive) == 1
        assert inactive[0]["event"]["details"]["action"] == "inactive_trigger"
        assert hass.states.get(main.entity_id).state == "on"
    else:
        assert commands == []
        assert hass.states.get(main.entity_id).attributes["current"] == 2
        assert not any(item["event"]["type"] in {"inactive", "cancelled"} for item in entries)
    cleared = has_handler and clear_notification
    assert len(delivered) == (3 if cleared else 2)
    assert [item for item in delivered if item["message"] == "clear_notification"] == (
        [{"message": "clear_notification", "data": {"tag": alert["id"]}}] if cleared else []
    )
    assert sum(item["event"]["type"] == "notification_cleared" for item in entries) == int(cleared)
    assert not any(item["event"]["type"] in {"confirmation_completed", "confirmation_timeout"} for item in entries)
    await hass.services.async_call(
        "automation", "turn_off", {"entity_id": main.entity_id, "stop_actions": True}, blocking=True,
    )


async def test_confirmation_finishing_does_not_emit_inactive_or_clear(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Confirmation finishes a single main run without automatic notification clearing."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []
    commands = []
    inactive_events = []
    hass.bus.async_listen("ha_notifications_inactive", callback(lambda event: inactive_events.append(event)))

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    hass.bus.async_listen("ha_notifications_command", callback(lambda event: commands.append(event)))
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            startup=True,
            automation_mode="parallel",
            triggers=[{"trigger": "state", "entity_id": "input_boolean.alert_button", "to": "on"}],
        ),
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "actions": [],
            "reminders": {
                "enabled": False,
                "interval": 60,
            },
        },
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    generated = mock_automation_files["read_automations"]()
    assert len(generated) == 1
    assert "id" not in generated[0]["triggers"][-1]
    assert len(generated[0]["triggers"]) == 2

    hass.states.async_set("input_boolean.alert_button", "on")
    await _wait_for_history_events(entry.runtime_data, alert["id"], "waiting")
    entries = await entry.runtime_data.history.async_entries(alert["id"])
    waiting = next(item for item in entries if item["event"]["type"] == "waiting")
    waiting_flow_id = waiting["event"]["flow_id"]
    started = next(item for item in entries if item["event"]["type"] == "started")
    started_by = started["event"]["details"]["started_by"]
    assert started_by["platform"] == "state"
    assert started_by["entity_id"] == "input_boolean.alert_button"
    assert started_by["from_state"] == "off"
    assert started_by["to_state"] == "on"
    assert len(delivered) == 1

    hass.states.async_set("input_boolean.alert_button", "off")
    assert inactive_events == []
    assert len(delivered) == 1
    hass.bus.async_fire("mobile_app_notification_action", {
        "action": delivered[0]["data"]["actions"][0]["action"],
    })
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
        state for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(alert)
    )
    assert main.attributes["current"] == 0


async def test_saving_alert_cancels_active_confirmation_wait(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """A generated automation reload must close history for stopped runs."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[{"trigger": "state", "entity_id": "input_boolean.alert_button", "to": "on"}],
            conditions=[{
                "condition": "state",
                "entity_id": "input_boolean.alert_button",
                "state": "on",
            }],
        ),
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "actions": [],
            "reminders": {"enabled": False, "interval": 60},
        },
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    hass.states.async_set("input_boolean.alert_button", "on")
    await asyncio.sleep(0)
    await asyncio.sleep(0)

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

    updated_alert = {**alert, "name": "Updated alert"}
    await ha_notifications.async_save_config(
        hass,
        entry,
        {"version": 1, "alerts": [updated_alert]},
    )
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
    assert run_events[0]["details"]["action"] == "automation_reloaded"


async def test_false_condition_report_does_not_cancel_pending_confirmation_wait(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """False-condition reporting leaves the pending wait available for confirmation."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []
    commands = []
    inactive_events = []
    hass.bus.async_listen("ha_notifications_command", callback(lambda event: commands.append(event)))
    hass.bus.async_listen("ha_notifications_inactive", callback(lambda event: inactive_events.append(event)))

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    hass.states.async_set("binary_sensor.alert_guard", "on")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            automation_mode="restart",
            triggers=[
                {"trigger": "state", "entity_id": "input_boolean.alert_button", "to": "on"},
                {"trigger": "state", "entity_id": "binary_sensor.alert_guard"},
            ],
            conditions=[{
                "condition": "state",
                "entity_id": "binary_sensor.alert_guard",
                "state": "on",
            }],
        ),
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "actions": [],
            "reminders": {"enabled": False, "interval": 60},
        },
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    hass.states.async_set("input_boolean.alert_button", "on")
    await _wait_for_history_events(entry.runtime_data, alert["id"], "waiting")

    entries = await entry.runtime_data.history.async_entries(alert["id"])
    waiting = next(
        item for item in entries if item["event"]["type"] == "waiting"
    )
    waiting_flow_id = waiting["event"]["flow_id"]
    assert len(delivered) == 1
    main_automation = next(
        state
        for state in hass.states.async_all("automation")
        if state.attributes.get("id") == automation_id(alert)
    )
    assert main_automation.attributes["current"] == 1

    hass.states.async_set("binary_sensor.alert_guard", "off")
    await _wait_for_history_events(entry.runtime_data, alert["id"], "inactive")

    entries = await entry.runtime_data.history.async_entries(alert["id"])
    assert commands == []
    assert inactive_events == []
    assert len(delivered) == 1
    assert delivered[0]["message"] != "clear_notification"
    assert hass.states.get(main_automation.entity_id).attributes["current"] == 1
    assert not any(item["event"]["type"] == "cancelled" for item in entries)

    hass.bus.async_fire("mobile_app_notification_action", {
        "action": delivered[0]["data"]["actions"][0]["action"],
    })
    await hass.async_block_till_done()
    entries = await entry.runtime_data.history.async_entries(alert["id"])
    flow_events = [
        item["event"]["type"]
        for item in entries
        if item["event"].get("flow_id") == waiting_flow_id
    ]
    assert flow_events[0] == "confirmation_completed"
    assert "cancelled" not in flow_events
    assert "confirmation_timeout" not in flow_events
    assert commands == []
    assert inactive_events == []
    assert len(delivered) == 1
    main_automation = hass.states.get(main_automation.entity_id)
    assert main_automation.attributes["current"] == 0


async def test_confirmation_timeout_retries_are_bounded_without_follow_ups(
    hass: HomeAssistant,
    alert_factory,
    mock_automation_files,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Timeouts repeat reminders finitely and skip response-only actions."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
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
    mock_automation_files["prepare"]()
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("binary_sensor.confirmation", "off")
    alert = alert_factory(
        "base",
        monitor=_monitor(
            triggers=[{"trigger": "state", "entity_id": "binary_sensor.confirmation"}],
            conditions=[{
                "condition": "state",
                "entity_id": "binary_sensor.confirmation",
                "state": "on",
            }],
        ),
        confirmation={
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "reminders": {
                "enabled": True,
                "interval": 0.01,
                "max_attempts": 2,
            },
            "notification": {
                "action": "notify.mobile_app_phone",
                "data": {"message": "Confirmed"},
            },
            "actions": [{"action": "light.turn_on"}],
        },
        post_send_actions={
            "enabled": True,
            "actions": [{"action": "logbook.log", "data": {"name": "sent"}}],
        },
    )
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={"version": 1, "alerts": [alert]},
    )
    entry.add_to_hass(hass)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    hass.states.async_set("binary_sensor.confirmation", "on")
    await hass.async_block_till_done()
    await asyncio.sleep(0.1)
    await hass.async_block_till_done()

    assert len(delivered) == 3
    assert delivered[0]["message"] == "Message"
    assert all(item.get("message") != "Confirmed" for item in delivered)
    assert post_send_calls == [{"name": "sent"}]
    assert confirmation_calls == []
    history_entries = await entry.runtime_data.history.async_entries("base_alert")
    event_types = [
        item.get("event", {}).get("type") for item in history_entries
    ]
    assert "confirmation_timeout" in event_types
    assert "confirmation_completed" not in event_types
    assert "confirmation_resumed" not in event_types
    assert "automation_completed" not in event_types