"""Tests for condition evaluation and transition boundaries."""

from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone

import pytest
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.ha_notifications.const import WorkflowSource
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()

ConditionWatchers = importlib.import_module(
    f"{PACKAGE_NAME}.features.conditions"
).ConditionWatchers
compile_condition = importlib.import_module(
    f"{PACKAGE_NAME}.features.conditions"
).compile_condition


def test_compile_condition_contract(snapshot):
    compiled = compile_condition(
        {
            "logic": "any",
            "conditions": [
                {
                    "type": "state",
                    "entity_id": ["binary_sensor.door"],
                    "state": ["on", "open"],
                    "for": 5,
                },
                {
                    "type": "numeric",
                    "entity_id": "sensor.temperature",
                    "above": 20,
                    "below": 30,
                },
                {
                    "type": "attribute",
                    "entity_id": "light.kitchen",
                    "attribute": "brightness",
                    "value": 255,
                },
                {"type": "template", "template": "{{ is_state('x', 'on') }}"},
            ],
        }
    )

    assert compiled == snapshot


def test_compile_condition_defaults_to_true_for_empty_or_disabled_conditions():
    assert compile_condition({"conditions": []}) == "{{ true }}"
    assert (
        compile_condition(
            {"conditions": [{"type": "state", "enabled": False}]}
        )
        == "{{ true }}"
    )


def test_compile_condition_skips_incomplete_conditions_and_renders_block_template():
    compiled = compile_condition(
        {
            "conditions": [
                {"type": "state", "entity_id": "sensor.one"},
                {"type": "numeric", "entity_id": "sensor.two"},
                {
                    "type": "template",
                    "template": "{% if is_state('sensor.one', 'on') %}true{% endif %}",
                },
            ]
        }
    )

    assert "{% set nc_condition_0 %}" in compiled
    assert "{% endset %}" in compiled


def test_compile_condition_skips_empty_template_conditions():
    assert (
        compile_condition({"conditions": [{"type": "template", "template": ""}]})
        == "{{ true }}"
    )


@pytest.mark.usefixtures("enable_custom_integrations")
@pytest.mark.asyncio
async def test_inactive_evaluation_does_not_allocate_confirmation(
    loaded_config_entry, alert_factory
):
    controller = loaded_config_entry.runtime_data
    alert = alert_factory("inactive_condition")
    await controller.dispatch(
        "configuration.save_config", {"version": 1, "alerts": [alert]}
    )
    await controller.reload()
    conditions = controller._lifecycle.feature("conditions")
    runtime = controller._lifecycle.feature("alerts").runtime(alert["id"])
    now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    await conditions.condition_result(
        alert["id"], False, None, source=WorkflowSource.CHANGE, now=now
    )

    assert runtime.last_evaluated == "2024-01-01T00:00:00+00:00"
    assert runtime.confirmation.action_ids == {}
    assert runtime.condition_active is False


@pytest.mark.usefixtures("enable_custom_integrations")
@pytest.mark.asyncio
async def test_condition_error_does_not_allocate_confirmation(
    hass,
    loaded_config_entry,
    alert_factory,
):
    controller = loaded_config_entry.runtime_data
    alert = alert_factory("error_condition")
    await controller.dispatch(
        "configuration.save_config", {"version": 1, "alerts": [alert]}
    )
    await controller.reload()
    conditions = controller._lifecycle.feature("conditions")
    runtime = controller._lifecycle.feature("alerts").runtime(alert["id"])
    now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    await conditions.condition_result(
        alert["id"],
        None,
        "template failed",
        source=WorkflowSource.CHANGE,
        now=now,
    )
    await hass.async_block_till_done()

    assert runtime.last_evaluated == "2024-01-01T00:00:00+00:00"
    assert runtime.last_error == "template failed"
    assert runtime.confirmation.action_ids == {}


def test_conditions_depend_on_alert_coordinator():
    conditions = importlib.import_module(f"{PACKAGE_NAME}.features.conditions")
    assert "alert_coordinator" in conditions.ConditionFeature.dependencies

def test_watchers_register_change_and_both_interval_sources():
    calls = []
    removed = []
    watchers = ConditionWatchers(
        None,
        lambda *args: None,
        lambda *args: None,
        lambda _alert: timedelta(seconds=60),
    )

    def track_template(source, callback):
        calls.append(("template", source, callback))
        return lambda: removed.append("template")

    def track_interval(interval, callback):
        calls.append(("interval", interval, callback))
        return lambda: removed.append("interval")

    watchers._track_template = track_template
    watchers._track_interval = track_interval
    watchers.configure(
        {
            "id": "alert_1",
            "enabled": True,
            "notification": {"message": "Message"},
            "conditions": [{"type": "template", "template": "{{ true }}"}],
            "monitor": {"on_change": True, "interval": 30},
            "confirmation": {
                "enabled": True,
                "reminders": {"enabled": True, "interval": 60},
            },
        }
    )

    assert [call[0] for call in calls] == ["template", "interval", "interval"]
    watchers.unconfigure("alert_1")
    assert removed == ["template", "interval", "interval"]


@pytest.mark.asyncio
async def test_real_template_watcher_tracks_home_assistant_state(hass):
    results = []
    watchers = ConditionWatchers(
        hass,
        lambda _alert_id, active, error, source: results.append(
            (active, error, source)
        ),
        lambda *_args: None,
    )
    hass.states.async_set("binary_sensor.real_door", "off")
    await hass.async_block_till_done()

    watchers.configure(
        {
            "id": "real_state_alert",
            "enabled": True,
            "notification": {"message": "Door opened"},
            "conditions": [
                {
                    "type": "state",
                    "entity_id": ["binary_sensor.real_door"],
                    "state": ["on"],
                }
            ],
            "monitor": {"on_change": True},
        }
    )
    await hass.async_block_till_done()

    hass.states.async_set("binary_sensor.real_door", "on")
    await hass.async_block_till_done()

    assert results
    assert results[-1][0] is True
    assert results[-1][1] is None
    watchers.unconfigure("real_state_alert")


@pytest.mark.asyncio
async def test_numeric_duration_tracks_threshold_membership(hass):
    results = []
    watchers = ConditionWatchers(
        hass,
        lambda _alert_id, active, error, _source: results.append((active, error)),
        lambda *_args: None,
    )
    hass.states.async_set("sensor.temperature", "19")
    await hass.async_block_till_done()

    watchers.configure(
        {
            "id": "numeric_duration_alert",
            "enabled": True,
            "notification": {"message": "Too cold"},
            "conditions": [
                {
                    "type": "numeric",
                    "entity_id": "sensor.temperature",
                    "below": 20,
                    "for": 60,
                }
            ],
            "monitor": {"on_change": True},
        }
    )
    await hass.async_block_till_done()

    hass.states.async_set("sensor.temperature", "21")
    await hass.async_block_till_done()
    hass.states.async_set("sensor.temperature", "19")
    await hass.async_block_till_done()
    assert results[-1] == (False, None)

    hass.states.async_set("sensor.temperature", "16")
    await hass.async_block_till_done()
    assert results[-1] == (False, None)

    async_fire_time_changed(
        hass, datetime.now(timezone.utc) + timedelta(seconds=61)
    )
    await hass.async_block_till_done()
    assert results[-1] == (True, None)

    hass.states.async_set("sensor.temperature", "21")
    await hass.async_block_till_done()
    assert results[-1] == (False, None)

    watchers.unconfigure("numeric_duration_alert")
