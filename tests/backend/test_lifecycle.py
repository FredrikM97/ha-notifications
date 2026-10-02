"""Tests for the Home Assistant Notifications config-entry lifecycle."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

import pytest
import yaml
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import HomeAssistant
from homeassistant.helpers import category_registry as cr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import label_registry as lr
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed_exact,
)

from custom_components import ha_notifications
from custom_components.ha_notifications.automation import automation_id
from custom_components.ha_notifications.const import (
    AUTOMATION_CATEGORY,
    AUTOMATION_CATEGORY_SCOPE,
    AUTOMATION_FILE,
    AUTOMATION_LABEL,
    DOMAIN,
)
from custom_components.ha_notifications.domain import RuntimeData


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
                "monitor": {"clear_on_condition_change": True},
            }],
        },
        )

    assert await ha_notifications.async_setup_entry(hass, entry)
    assert getattr(entry, "runtime_data", None) is None


async def test_config_entry_update_reload_and_unload_are_reconciled(
    hass: HomeAssistant,
    monkeypatch,
    alert_factory,
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
    path = hass.config.path(AUTOMATION_FILE)
    with open(path, "w") as stream:
        stream.write("[]\n")

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

    document = yaml.safe_load(open(path).read())
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

    document = yaml.safe_load(open(path).read())
    assert document[0]["alias"] == "HA Notifications: Updated alert"

    assert await ha_notifications.async_unload_entry(hass, entry)
    await hass.async_block_till_done()
    assert reload_count == 3

    document = yaml.safe_load(open(path).read())
    assert document == []
    assert not hass.services.has_service(DOMAIN, "send")
    assert not hass.services.has_service(DOMAIN, "clear")
    assert await ha_notifications.async_unload_entry(hass, entry)

    assert await ha_notifications.async_setup_entry(hass, entry)
    await hass.async_block_till_done()
    assert reload_count == 4
    document = yaml.safe_load(open(path).read())
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
    enable_custom_integrations,
    monkeypatch,
    service_calls,
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
    configuration_path = hass.config.path("configuration.yaml")
    with open(configuration_path, "w") as configuration_file:
        configuration_file.write("automation ha_notifications: !include ha_notifications_automations.yaml\n")
    assert await async_setup_component(hass, "automation", {})
    alert = alert_factory(
        "base",
        conditions=[{
            "condition": "state",
            "entity_id": "binary_sensor.door",
            "state": "on",
        }],
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
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write("automation ha_notifications: !include ha_notifications_automations.yaml\n")
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("binary_sensor.door", "off")
    alert = alert_factory(
        "base",
        conditions=[{
            "condition": "state",
            "entity_id": "binary_sensor.door",
            "state": "on",
        }],
        triggers=[
            {"trigger": "state", "entity_id": "binary_sensor.door"},
            {"trigger": "homeassistant", "event": "start"},
        ],
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
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write("automation ha_notifications: !include ha_notifications_automations.yaml\n")
    assert await async_setup_component(hass, "automation", {})
    alert = alert_factory(
        "base",
        triggers=[{"trigger": "homeassistant", "event": "start"}],
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
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write("automation ha_notifications: !include ha_notifications_automations.yaml\n")
    assert await async_setup_component(hass, "automation", {})
    alert = alert_factory(
        "base",
        triggers=[{"trigger": "time_pattern", "seconds": "/1"}],
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
    async_fire_time_changed_exact(
        hass,
        dt_util.utcnow() + timedelta(seconds=1),
        fire_all=False,
    )
    await hass.async_block_till_done()
    await ha_notifications.async_unload_entry(hass, entry)
    await hass.async_block_till_done()

    assert delivered == [
        {"message": "Message", "data": {"tag": "base_alert"}}
    ]


async def test_generated_native_for_trigger_uses_ha_clock_across_reload(
    hass: HomeAssistant,
    alert_factory,
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
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write("automation ha_notifications: !include ha_notifications_automations.yaml\n")
    assert await async_setup_component(hass, "automation", {})
    hass.states.async_set("sensor.temperature", "20")
    alert = alert_factory(
        "base",
        triggers=[{"trigger": "state", "entity_id": "sensor.temperature"}],
        conditions=[{
            "condition": "numeric_state",
            "entity_id": "sensor.temperature",
            "above": 30,
        }],
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


async def test_on_condition_change_triggers_from_multiple_condition_entities(
    hass: HomeAssistant,
    alert_factory,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Execute when either condition dependency changes."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write("automation ha_notifications: !include ha_notifications_automations.yaml\n")
    assert await async_setup_component(hass, "automation", {})
    hass.states.async_set("sensor.first_dependency", "off")
    hass.states.async_set("sensor.second_dependency", "off")
    alert = alert_factory(
        "base",
        triggers=[],
        on_condition_change=True,
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
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write("automation ha_notifications: !include ha_notifications_automations.yaml\n")
    assert await async_setup_component(hass, "automation", {})
    hass.states.async_set("sensor.repeated_dependency", "off")
    alert = alert_factory(
        "base",
        triggers=[{
            "trigger": "state",
            "entity_id": "sensor.repeated_dependency",
        }],
        conditions=[{
            "condition": "state",
            "entity_id": "sensor.repeated_dependency",
            "state": "on",
        }],
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
    hass.states.async_set("binary_sensor.window", "off")
    hass.states.async_set("sensor.temperature", "20")
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write(
            "automation ha_notifications: !include ha_notifications_automations.yaml\n"
        )
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
    document = yaml.safe_load(open(hass.config.path(AUTOMATION_FILE)).read())
    assert [item["id"] for item in document] == [
        "ha_notifications_full_feature",
        "ha_notifications_full_feature_condition_inactive",
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

    hass.bus.async_fire(
        "mobile_app_notification_action",
        {"action": "ha_notifications_full_feature_confirmation_confirm"},
    )
    await hass.async_block_till_done()
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
    assert {"notification_sent", "waiting", "confirmation_completed"} <= (
        completed_flow_events
    )

    updated = {**full_feature_alert, "name": "Updated full feature"}
    await ha_notifications.async_save_config(
        hass,
        entry,
        {"version": 1, "alerts": [updated]},
    )
    await hass.async_block_till_done()
    document = yaml.safe_load(open(hass.config.path(AUTOMATION_FILE)).read())
    assert document[0]["id"] == "ha_notifications_full_feature"
    assert document[0]["alias"] == "HA Notifications: Updated full feature"

    await ha_notifications.async_save_config(
        hass,
        entry,
        {"version": 1, "alerts": []},
    )
    await hass.async_block_till_done()
    document = yaml.safe_load(open(hass.config.path(AUTOMATION_FILE)).read())
    assert document == []


async def test_confirmation_response_completes_without_follow_ups(
    hass: HomeAssistant,
    alert_factory,
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
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write(
            "automation ha_notifications: !include ha_notifications_automations.yaml\n"
        )
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("binary_sensor.confirmation", "off")
    alert = alert_factory(
        "base",
        triggers=[{
            "trigger": "state",
            "entity_id": "binary_sensor.confirmation",
        }],
        conditions=[{
            "condition": "state",
            "entity_id": "binary_sensor.confirmation",
            "state": "on",
        }],
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


async def test_inactive_transition_cancels_all_parallel_confirmation_waits(
    hass: HomeAssistant,
    alert_factory,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """One inactive command wakes each parallel wait for the same alert."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write(
            "automation ha_notifications: !include ha_notifications_automations.yaml\n"
        )
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    hass.states.async_set("binary_sensor.second_trigger", "off")
    alert = alert_factory(
        "base",
        automation_mode="parallel",
        cancel_on_inactive=True,
        triggers=[
            {
                "trigger": "state",
                "entity_id": "input_boolean.alert_button",
                "to": "on",
            },
            {
                "trigger": "state",
                "entity_id": "binary_sensor.second_trigger",
                "to": "on",
            },
        ],
        conditions=[{
            "condition": "state",
            "entity_id": "input_boolean.alert_button",
            "state": "on",
        }],
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
    hass.states.async_set("binary_sensor.second_trigger", "on")
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    entries = await entry.runtime_data.history.async_entries(alert["id"])
    assert sum(item["event"]["type"] == "waiting" for item in entries) == 2
    assert len(delivered) == 2

    hass.states.async_set("input_boolean.alert_button", "off")
    await hass.async_block_till_done()

    entries = await entry.runtime_data.history.async_entries(alert["id"])
    assert sum(
        item["event"]["type"] == "cancelled"
        and item["event"]["details"].get("action") == "confirmation_cancelled"
        for item in entries
    ) == 2
    assert not any(
        item["event"]["type"] == "confirmation_timeout"
        for item in entries
    )


async def test_inverse_state_trigger_in_main_automation_cancels_wait_without_conditions(
    hass: HomeAssistant,
    alert_factory,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """Run the inferred inverse edge in the main automation only."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []
    commands = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    hass.bus.async_listen("ha_notifications_command", commands.append)
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write(
            "automation ha_notifications: !include ha_notifications_automations.yaml\n"
        )
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    alert = alert_factory(
        "base",
        automation_mode="parallel",
        cancel_on_inactive=True,
        on_condition_change=True,
        triggers=[
            {"trigger": "homeassistant", "event": "start"},
            {
                "trigger": "state",
                "entity_id": "input_boolean.alert_button",
                "to": "on",
            },
        ],
        conditions=[],
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
    with open(hass.config.path(AUTOMATION_FILE)) as automation_file:
        generated = yaml.safe_load(automation_file)
    assert len(generated) == 1
    assert any(
        trigger.get("id") == "inactive_alert_button"
        for trigger in generated[0]["triggers"]
    )

    hass.states.async_set("input_boolean.alert_button", "on")
    await asyncio.sleep(0)
    await asyncio.sleep(0)
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
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    hass.states.async_set("input_boolean.alert_button", "off")
    await hass.async_block_till_done()

    entries = await entry.runtime_data.history.async_entries(alert["id"])
    assert [event.data for event in commands] == [{
        "alert_id": alert["id"],
        "command": "cancel_run",
    }]
    assert any(
        item["event"]["type"] == "cancelled"
        and item["event"]["details"].get("action") == "confirmation_cancelled"
        and item["event"].get("flow_id") == waiting_flow_id
        for item in entries
    ), entries
    assert len(delivered) == 1


async def test_inactive_transition_cancels_restart_mode_confirmation_wait(
    hass: HomeAssistant,
    alert_factory,
    enable_custom_integrations,
    monkeypatch,
) -> None:
    """A false trigger must not restart away the wait before its event."""
    async def register_panel(_hass: HomeAssistant) -> None:
        return None

    monkeypatch.setattr(ha_notifications, "async_register_panel", register_panel)
    delivered: list[dict[str, object]] = []

    async def handle_notification(call) -> None:
        delivered.append(dict(call.data))

    hass.services.async_register("notify", "mobile_app_phone", handle_notification)
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write(
            "automation ha_notifications: !include ha_notifications_automations.yaml\n"
        )
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("input_boolean.alert_button", "off")
    alert = alert_factory(
        "base",
        automation_mode="restart",
        cancel_on_inactive=True,
        triggers=[{
            "trigger": "state",
            "entity_id": "input_boolean.alert_button",
            "to": "on",
        }],
        conditions=[{
            "condition": "state",
            "entity_id": "input_boolean.alert_button",
            "state": "on",
        }],
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

    hass.states.async_set("input_boolean.alert_button", "off")
    await hass.async_block_till_done()

    entries = await entry.runtime_data.history.async_entries(alert["id"])
    assert any(
        item["event"]["type"] == "cancelled"
        and item["event"]["details"].get("action") == "confirmation_cancelled"
        and item["event"].get("flow_id") == waiting_flow_id
        for item in entries
    )
    flow_events = [
        item["event"]["type"]
        for item in entries
        if item["event"].get("flow_id") == waiting_flow_id
    ]
    assert flow_events[0] == "cancelled"
    main_automation = hass.states.get(main_automation.entity_id)
    assert main_automation.attributes["current"] == 0


async def test_confirmation_timeout_retries_are_bounded_without_follow_ups(
    hass: HomeAssistant,
    alert_factory,
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
    with open(hass.config.path("configuration.yaml"), "w") as configuration_file:
        configuration_file.write("automation ha_notifications: !include ha_notifications_automations.yaml\n")
    assert await async_setup_component(hass, "automation", {})

    hass.states.async_set("binary_sensor.confirmation", "off")
    alert = alert_factory(
        "base",
        conditions=[{
            "condition": "state",
            "entity_id": "binary_sensor.confirmation",
            "state": "on",
        }],
        triggers=[{
            "trigger": "state",
            "entity_id": "binary_sensor.confirmation",
        }],
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