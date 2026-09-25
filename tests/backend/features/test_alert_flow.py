"""Tests for ordered alert effect orchestration through Home Assistant."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.ha_notifications.const import AlertEventType, WorkflowSource

pytestmark = [pytest.mark.usefixtures("enable_custom_integrations")]


@pytest.fixture
def alert_flow_context(hass, loaded_config_entry):
    controller = loaded_config_entry.runtime_data

    async def load_alert(alert, *, startup=False):
        alert.setdefault("monitor", {})["startup"] = startup
        alert["conditions"] = [{"type": "template", "template": "{{ false }}"}]
        await controller.dispatch(
            "configuration.save_config", {"version": 1, "alerts": [alert]}
        )
        await controller.reload()
        await hass.async_block_till_done()
        return controller

    async def condition_result(
        alert_id,
        active,
        source=WorkflowSource.CHANGE,
        now=datetime(2026, 1, 1, tzinfo=timezone.utc),
        error=None,
    ):
        conditions = controller._lifecycle.feature("conditions")
        await conditions.condition_result(
            alert_id, active, error, source=source, now=now
        )
        await hass.async_block_till_done()

    async def history_for(alert_id):
        return await controller.dispatch("history.list", alert_id=alert_id)

    return SimpleNamespace(
        controller=controller,
        load_alert=load_alert,
        condition_result=condition_result,
        history_for=history_for,
    )


@pytest.mark.asyncio
async def test_exhausted_confirmation_clears_notification(
    hass, real_target_registry, confirmation_alert_factory, alert_flow_context
):
    alert = confirmation_alert_factory("exhausted")
    alert["notification"]["target"] = {
        "entity_id": [real_target_registry.notify_entity_id]
    }
    alert["confirmation"]["reminders"]["max_attempts"] = 2
    calls = async_mock_service(hass, "notify", "mobile_app_phone")
    controller = await alert_flow_context.load_alert(alert)
    await alert_flow_context.condition_result(alert["id"], True)
    runtime = controller._lifecycle.feature("alerts").runtime(alert["id"])
    runtime.confirmation.attempts = 2
    await alert_flow_context.condition_result(
        alert["id"], True, WorkflowSource.CONFIRMATION
    )
    assert any(call.data["message"] == "clear_notification" for call in calls)
    history = await alert_flow_context.history_for(alert["id"])
    assert any(
        entry["event"]["type"] == AlertEventType.CONFIRMATION_ATTEMPTS_EXHAUSTED.value
        for entry in history
    )
    assert any(
        entry["event"]["type"] == AlertEventType.NOTIFICATION_CLEARED.value
        and entry["event"]["details"]["reason"]
        == "confirmation_attempts_exhausted"
        for entry in history
    )


@pytest.mark.asyncio
async def test_condition_error_and_inactive_clear_notification(
    hass, real_target_registry, alert_factory, alert_flow_context
):
    alert = alert_factory("inactive")
    alert["notification"]["target"] = {
        "entity_id": [real_target_registry.notify_entity_id]
    }
    calls = async_mock_service(hass, "notify", "mobile_app_phone")
    await alert_flow_context.load_alert(alert)
    await alert_flow_context.condition_result(alert["id"], None, error="bad template")
    history = await alert_flow_context.history_for(alert["id"])
    assert history[0]["event"]["type"] == AlertEventType.CONDITION_ERROR.value
    await alert_flow_context.condition_result(alert["id"], True)
    await alert_flow_context.condition_result(alert["id"], False)
    assert any(call.data["message"] == "clear_notification" for call in calls)
    history = await alert_flow_context.history_for(alert["id"])
    assert any(
        entry["event"]["type"] == AlertEventType.NOTIFICATION_CLEARED.value
        and entry["event"]["details"]["reason"] == "condition_inactive"
        for entry in history
    )


@pytest.mark.asyncio
async def test_condition_change_clear_can_be_disabled(
    hass, real_target_registry, alert_factory, alert_flow_context
):
    alert = alert_factory("no_clear", monitor={"clear_on_inactive": False})
    alert["notification"]["target"] = {
        "entity_id": [real_target_registry.notify_entity_id]
    }
    calls = async_mock_service(hass, "notify", "mobile_app_phone")
    await alert_flow_context.load_alert(alert)
    await alert_flow_context.condition_result(alert["id"], True)
    calls.clear()
    await alert_flow_context.condition_result(alert["id"], False)
    assert calls == []


@pytest.mark.asyncio
async def test_active_condition_sends_and_runs_follow_up(
    hass, alert_factory, alert_flow_context
):
    notify_calls = async_mock_service(hass, "notify", "send_message")
    follow_up_calls = async_mock_service(hass, "light", "turn_on")
    alert = alert_factory(
        "active",
        post_send_actions={
            "enabled": True,
            "actions": [
                {
                    "action": "light.turn_on",
                    "target": {"entity_id": ["light.alert"]},
                }
            ],
        },
    )
    await alert_flow_context.load_alert(alert)
    notify_calls.clear()
    follow_up_calls.clear()
    await alert_flow_context.condition_result(alert["id"], True)
    assert len(notify_calls) == 1
    assert len(follow_up_calls) == 1
    history = await alert_flow_context.history_for(alert["id"])
    event_types = [entry["event"]["type"] for entry in history]
    assert AlertEventType.NOTIFICATION_SENT.value in event_types
    assert AlertEventType.NOTIFICATION_ACTION.value in event_types


@pytest.mark.asyncio
async def test_test_source_sends_even_when_startup_delivery_is_disabled(
    hass, alert_factory, alert_flow_context
):
    calls = async_mock_service(hass, "notify", "send_message")
    alert = alert_factory("test", monitor={"startup": False})
    await alert_flow_context.load_alert(alert)
    calls.clear()
    await alert_flow_context.condition_result(alert["id"], True, WorkflowSource.TEST)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_condition_change_source_sends_notification(
    hass, alert_factory, alert_flow_context
):
    calls = async_mock_service(hass, "notify", "send_message")
    alert = alert_factory("change")
    await alert_flow_context.load_alert(alert)
    calls.clear()
    await alert_flow_context.condition_result(alert["id"], True)
    assert len(calls) == 1
    history = await alert_flow_context.history_for(alert["id"])
    assert any(
        entry["event"]["type"] == AlertEventType.CONDITION_ACTIVE.value
        for entry in history
    )


@pytest.mark.asyncio
async def test_acknowledged_alert_blocks_condition_change_notification(
    hass, alert_factory, alert_flow_context
):
    calls = async_mock_service(hass, "notify", "send_message")
    alert = alert_factory("acknowledged")
    controller = await alert_flow_context.load_alert(alert)
    calls.clear()
    await alert_flow_context.condition_result(alert["id"], True)
    calls.clear()
    controller._lifecycle.feature("alerts").runtime(alert["id"]).state[
        "acknowledged"
    ] = True
    await alert_flow_context.condition_result(alert["id"], True)
    assert calls == []


@pytest.mark.asyncio
async def test_startup_attempt_is_not_repeated_after_delivery_failure(
    hass, alert_factory, alert_flow_context
):
    alert = alert_factory("startup_failure")
    await alert_flow_context.load_alert(alert, startup=True)
    await alert_flow_context.condition_result(alert["id"], True, WorkflowSource.STARTUP)
    await alert_flow_context.condition_result(alert["id"], True, WorkflowSource.STARTUP)
    history = await alert_flow_context.history_for(alert["id"])
    deliveries = [
        entry
        for entry in history
        if entry["event"]["type"]
        in {
            AlertEventType.NOTIFICATION_SENT.value,
            AlertEventType.NOTIFICATION_FAILED.value,
        }
    ]
    assert len(deliveries) == 1
    assert deliveries[0]["event"]["type"] == AlertEventType.NOTIFICATION_FAILED.value


@pytest.mark.asyncio
async def test_startup_attempt_is_allowed_for_a_new_activation_flow(
    hass, alert_factory, alert_flow_context
):
    calls = async_mock_service(hass, "notify", "send_message")
    alert = alert_factory("new_activation")
    await alert_flow_context.load_alert(alert, startup=True)
    await alert_flow_context.condition_result(alert["id"], True, WorkflowSource.STARTUP)
    await alert_flow_context.condition_result(alert["id"], True, WorkflowSource.STARTUP)
    await alert_flow_context.condition_result(alert["id"], False)
    await alert_flow_context.condition_result(alert["id"], True, WorkflowSource.STARTUP)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_failed_delivery_records_failure_without_follow_up(
    hass, alert_factory, alert_flow_context
):
    async_mock_service(hass, "notify", "test")
    alert = alert_factory(
        "failed",
        post_send_actions={"enabled": True, "actions": [{"action": "light.turn_on"}]},
    )
    controller = await alert_flow_context.load_alert(alert)
    await alert_flow_context.condition_result(alert["id"], True)
    runtime = controller._lifecycle.feature("alerts").runtime(alert["id"])
    assert runtime.confirmation.attempts == 0
    history = await alert_flow_context.history_for(alert["id"])
    assert any(
        entry["event"]["type"] == AlertEventType.NOTIFICATION_FAILED.value
        for entry in history
    )
    assert not any(
        entry["event"]["type"] == AlertEventType.NOTIFICATION_ACTION.value
        for entry in history
    )


@pytest.mark.asyncio
async def test_reminder_sends_next_attempt_as_replacement(
    hass, real_target_registry, confirmation_alert_factory, alert_flow_context
):
    calls = async_mock_service(hass, "notify", "mobile_app_phone")
    alert = confirmation_alert_factory("reminder")
    alert["notification"]["target"] = {
        "entity_id": [real_target_registry.notify_entity_id]
    }
    controller = await alert_flow_context.load_alert(alert)
    runtime = controller._lifecycle.feature("alerts").runtime(alert["id"])
    await alert_flow_context.condition_result(alert["id"], True)
    runtime.confirmation.attempts = 1
    reminder_now = datetime.fromisoformat(runtime.last_notified) + timedelta(seconds=3)
    await alert_flow_context.condition_result(
        alert["id"],
        True,
        WorkflowSource.CONFIRMATION,
        reminder_now,
    )
    assert len(calls) >= 2
    assert calls[-1].data["data"]["actions"]
    history = await alert_flow_context.history_for(alert["id"])
    sent = [
        entry
        for entry in history
        if entry["event"]["type"] == AlertEventType.NOTIFICATION_SENT.value
    ]
    assert sent[-1]["event"]["details"]["attempt"] == 1


@pytest.mark.asyncio
async def test_condition_effects_update_runtime_state(
    hass, alert_factory, alert_flow_context
):
    alert = alert_factory("runtime")
    controller = await alert_flow_context.load_alert(alert)
    await alert_flow_context.condition_result(alert["id"], True)
    assert (
        controller._lifecycle.feature("alerts").runtime(alert["id"]).condition_active
        is True
    )
