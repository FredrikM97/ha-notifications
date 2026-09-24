"""Tests for the feature-owned confirmation configuration and workflow helpers."""

from __future__ import annotations

import importlib
from datetime import datetime, timezone
from types import MappingProxyType, SimpleNamespace

import pytest
from homeassistant.core import Context, Event
from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.ha_notifications.const import EVENT_NOTIFICATION_ACTION
from custom_components.ha_notifications.domain.runtime import AlertRuntimeState
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
confirmation = importlib.import_module(f"{PACKAGE_NAME}.features.confirmations")


@pytest.fixture
def confirmation_feature():
    return confirmation.ConfirmationFeature(None)


@pytest.fixture
def confirmation_sessions(confirmation_feature):
    return confirmation_feature._sessions


@pytest.fixture
def confirmation_now():
    return datetime(2024, 1, 1, tzinfo=timezone.utc)


@pytest.fixture
def confirmation_alert_context(hass, loaded_config_entry):
    """Load an alert through the real confirmation workflow."""

    controller = loaded_config_entry.runtime_data

    async def load_alert(alert):
        await controller.dispatch(
            "configuration.save_config", {"version": 1, "alerts": [alert]}
        )
        await controller.reload()
        await hass.async_block_till_done()
        runtime = controller._lifecycle.feature("alerts").runtime(alert["id"])
        assert runtime.confirmation.action_ids
        return controller, runtime

    return load_alert


def test_confirmation_configuration_contract_snapshot(snapshot):
    config = confirmation.ConfirmationConfig.model_validate(
        {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {
                "enabled": True,
                "message": "Confirmed by {{confirmed_by}}",
                "clear": True,
            },
            "reminders": {
                "enabled": True,
                "interval": 2,
                "max_attempts": 5,
                "show_attempts": True,
            },
        }
    )

    assert config.model_dump(exclude_none=True) == snapshot


def test_confirmation_defaults_are_owned_by_confirmation_feature():
    config = confirmation.ConfirmationConfig.model_validate({"enabled": True})

    assert config.enabled
    assert config.reminders.enabled
    assert not config.notification.enabled


def test_confirmation_is_read_from_alert_level():
    alert = {
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Done"}],
        }
    }

    config = confirmation.ConfirmationConfig.from_alert(alert)

    assert config is not None
    assert config.buttons[0].label == "Done"


async def test_prepare_action_requires_enabled_confirmation(confirmation_feature):
    alert = {"id": "alert_1", "confirmation": {"enabled": False}}
    runtime = AlertRuntimeState.for_alert(alert)

    confirmation_feature.prepare_action(runtime)

    assert not runtime.condition_active
    assert not runtime.confirmation.action_ids


async def test_prepare_action_is_idempotent_for_pending_action(confirmation_feature):
    alert = {"id": "alert_1", "confirmation": {"enabled": True}}
    runtime = AlertRuntimeState.for_alert(alert)

    confirmation_feature.prepare_action(runtime)
    first_action_ids = dict(runtime.confirmation.action_ids)
    confirmation_feature.prepare_action(runtime)

    assert runtime.confirmation.action_ids == first_action_ids


async def test_prepare_action_creates_one_pending_action_per_button(
    confirmation_feature,
):
    alert = {
        "id": "alert_1",
        "confirmation": {
            "enabled": True,
            "buttons": [
                {"id": "snooze", "label": "Snooze"},
                {"id": "escalate", "label": "Escalate"},
            ],
        },
    }
    runtime = AlertRuntimeState.for_alert(alert)

    confirmation_feature.prepare_action(runtime)

    assert set(runtime.confirmation.action_ids.values()) == {"snooze", "escalate"}


async def test_prepare_action_preserves_pending_actions(
    confirmation_feature, runtime_with_pending_factory
):
    runtime = runtime_with_pending_factory(
        {"id": "alert_1"}, action_ids={"action": "confirm"}
    )
    confirmation_feature.prepare_action(runtime)

    assert runtime.confirmation.action_ids == {"action": "confirm"}


async def test_clear_is_idempotent(confirmation_feature, confirmation_sessions):
    confirmation_feature.clear("missing")
    runtime = AlertRuntimeState(config={"id": "alert_1"})
    confirmation_feature.track("action", runtime=runtime)
    confirmation_feature.clear("action")

    assert "action" not in confirmation_sessions


async def test_expire_stale_clears_persisted_actions_and_sessions(
    confirmation_feature, confirmation_now, runtime_with_pending_factory
):
    runtime = runtime_with_pending_factory(
        {"id": "alert_1"}, action_ids={"action": "confirm"}
    )
    runtime.state["last_notified"] = "2023-12-20T00:00:00+00:00"
    confirmation_feature.track("action", runtime=runtime)

    expired = confirmation_feature.expire_stale(runtime, confirmation_now)

    assert expired
    assert runtime.confirmation.action_ids == {}
    assert not confirmation_feature.has_pending("action")


async def test_expire_exhausted_clears_actions_at_max_attempts(
    confirmation_feature, runtime_with_pending_factory
):
    alert = {
        "id": "alert_1",
        "confirmation": {
            "enabled": True,
            "reminders": {"enabled": True, "max_attempts": 2},
        },
    }
    runtime = runtime_with_pending_factory(
        alert, action_ids={"action": "confirm"}, attempts=2
    )
    confirmation_feature.track("action", runtime=runtime)

    expired = confirmation_feature.expire_exhausted(runtime)

    assert expired.attempts == 2
    assert expired.max_attempts == 2
    assert runtime.confirmation.action_ids == {}
    assert not confirmation_feature.has_pending("action")


@pytest.mark.usefixtures("enable_custom_integrations")
@pytest.mark.asyncio
async def test_apply_confirmation_uses_real_feature_workflow(
    hass,
    real_target_registry,
    confirmation_alert_factory,
    confirmation_alert_context,
    snapshot,
):
    notify_calls = async_mock_service(hass, "notify", "mobile_app_phone")
    follow_up_calls = async_mock_service(hass, "light", "turn_on")
    user = await hass.auth.async_create_user("Alice")
    hass.states.async_set(
        "person.alice",
        "home",
        {"user_id": user.id, "friendly_name": "Alice"},
    )
    alert = confirmation_alert_factory("workflow_confirmation")
    alert["notification"]["target"] = {
        "entity_id": [real_target_registry.notify_entity_id]
    }
    alert["confirmation"]["notification"] = {
        "enabled": True,
        "clear": True,
        "message": "Confirmed by {{ confirmed_by }}",
    }
    alert["confirmation"]["actions"] = {
        "enabled": True,
        "items": [
            {
                "action": "light.turn_on",
                "target": {"entity_id": ["light.confirmation"]},
                "data": {"brightness": 100},
            }
        ],
    }

    controller, runtime = await confirmation_alert_context(alert)
    action_id = next(iter(runtime.confirmation.action_ids))
    hass.bus.async_fire(
        EVENT_NOTIFICATION_ACTION,
        {"action": action_id},
        context=Context(user_id=user.id),
    )
    await hass.async_block_till_done()

    history = await controller.dispatch("history.list", alert_id=alert["id"])
    notifications = []
    for call in notify_calls:
        data = dict(call.data)
        notification_data = dict(data.get("data", {}))
        if "actions" in notification_data:
            notification_data["actions"] = [
                {"action": "<confirmation_action>", "title": action["title"]}
                for action in notification_data["actions"]
            ]
        if notification_data:
            data["data"] = notification_data
        notifications.append(data)
    assert {
        "runtime": {
            "action_ids": runtime.confirmation.action_ids,
            "acknowledged": runtime.acknowledged,
            "confirmed_by": runtime.confirmed_by,
        },
        "notifications": notifications,
        "follow_up_calls": [call.data for call in follow_up_calls],
        "history_types": [entry["event"]["type"] for entry in history],
    } == snapshot


@pytest.mark.usefixtures("enable_custom_integrations")
@pytest.mark.asyncio
async def test_resolve_saved_action_event_uses_real_home_assistant_event(
    hass,
    loaded_config_entry,
    confirmation_alert_factory,
    confirmation_alert_context,
):
    alert = confirmation_alert_factory("saved_confirmation")
    alert["name"] = "Saved"
    _controller, runtime = await confirmation_alert_context(alert)
    feature = loaded_config_entry.runtime_data._lifecycle.feature("confirmations")
    action_id = next(iter(runtime.confirmation.action_ids))

    result = await feature.resolve_action_event(
        Event(
            EVENT_NOTIFICATION_ACTION,
            {"action": action_id},
            context=Context(),
        )
    )

    assert result is not None
    assert result.runtime.config["name"] == "Saved"


@pytest.mark.usefixtures("enable_custom_integrations")
@pytest.mark.asyncio
async def test_notification_action_event_dispatches_real_confirmation_workflow(
    hass,
    confirmation_alert_factory,
    confirmation_alert_context,
):
    user = await hass.auth.async_create_user("Alice")
    hass.states.async_set(
        "person.alice",
        "home",
        {"user_id": user.id, "friendly_name": "Alice"},
    )
    alert = confirmation_alert_factory("event_confirmation")
    controller, runtime = await confirmation_alert_context(alert)
    action_id = next(iter(runtime.confirmation.action_ids))

    hass.bus.async_fire(
        EVENT_NOTIFICATION_ACTION,
        {"action": action_id},
        context=Context(user_id=user.id),
    )
    await hass.async_block_till_done()

    updated = controller._lifecycle.feature("alerts").runtime(alert["id"])
    assert updated.acknowledged
    assert updated.confirmed_by == "Alice"
    assert updated.confirmation.action_ids == {}


@pytest.mark.usefixtures("enable_custom_integrations")
@pytest.mark.asyncio
async def test_resolving_one_response_clears_sibling_responses(
    hass,
    confirmation_alert_factory,
    confirmation_alert_context,
):
    alert = confirmation_alert_factory("sibling_confirmation")
    alert["confirmation"]["buttons"] = [
        {"id": "snooze", "label": "Snooze"},
        {"id": "escalate", "label": "Escalate"},
    ]
    controller, runtime = await confirmation_alert_context(alert)
    feature = controller._lifecycle.feature("confirmations")
    action_ids = dict(runtime.confirmation.action_ids)
    snooze_action = next(
        action_id
        for action_id, response_id in action_ids.items()
        if response_id == "snooze"
    )

    result = await feature.resolve_action_event(
        Event(
            EVENT_NOTIFICATION_ACTION,
            {"action": snooze_action},
            context=Context(),
        )
    )

    assert result is not None
    assert result.confirmation.selection.response_id == "snooze"
    assert not feature.has_pending(snooze_action)
    sibling_action = next(action for action in action_ids if action != snooze_action)
    assert not feature.has_pending(sibling_action)


def test_person_resolution_handles_missing_and_unknown_users():
    assert confirmation.resolve_person_name([], None) == "Unknown user"
    assert (
        confirmation.resolve_person_name(
            [SimpleNamespace(attributes={"user_id": "other"}, name="Bob")], "u1"
        )
        == "Unknown user"
    )


def test_blank_person_name_falls_back_to_unknown_user():
    assert (
        confirmation.resolve_person_name(
            [SimpleNamespace(attributes={"user_id": "u1"}, name="")], "u1"
        )
        == "Unknown user"
    )


def test_extract_action_id_accepts_only_nonempty_mapping_actions():
    assert confirmation.extract_action_id(None) is None
    assert confirmation.extract_action_id({}) is None
    assert confirmation.extract_action_id({"action": "confirm_1"}) == "confirm_1"
    assert (
        confirmation.extract_action_id(MappingProxyType({"action": "confirm_1"}))
        == "confirm_1"
    )


@pytest.mark.asyncio
async def test_resolves_matching_person_from_real_home_assistant_state(hass):
    hass.states.async_set(
        "person.alice",
        "home",
        {"user_id": "u1", "friendly_name": "Alice"},
    )

    person_states = hass.states.async_all("person")

    assert confirmation.resolve_person_name(person_states, "u1") == "Alice"


@pytest.mark.asyncio
async def test_auth_user_fallback_uses_real_home_assistant_auth(hass):
    user = await hass.auth.async_create_user("Carol")

    assert await confirmation.resolve_confirmed_by(hass, [], user.id) == "Carol"
