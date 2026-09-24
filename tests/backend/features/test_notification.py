"""Tests for the feature-owned notification workflow."""

from __future__ import annotations

import importlib

import pytest
from homeassistant.components.notify.const import NOTIFY_SERVICE_SCHEMA
from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.ha_notifications.domain.confirmation import (
    ConfirmationContext,
    ConfirmationSelection,
)
from custom_components.ha_notifications.domain.runtime import AlertRuntimeState
from custom_components.ha_notifications.features.configuration import Alert
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
notifications = importlib.import_module(f"{PACKAGE_NAME}.features.notification")


async def render(source, _variables):
    return source


def notification_request(alert, *, condition_facts=None):
    return notifications.NotificationRequest(
        runtime=AlertRuntimeState.for_alert(alert),
        replace_existing=False,
        condition_facts=condition_facts or {},
    )


class TestNotificationWorkflow:
    async def test_template_context_exposes_condition_facts_and_trigger(
        self, notification_alert, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["message"] = (
            "{{ request.condition_facts.front_door }}"
        )
        captured = []

        async def capture_render(source, variables):
            captured.append(variables)
            return source

        await notifications.send_requested(
            notifications.NotificationRequest(
                runtime=AlertRuntimeState.for_alert(configured_alert),
                replace_existing=False,
                condition_facts={"front_door": True},
                trigger_source="change",
            ),
            notifications.NotificationCapabilitySet(
                render=capture_render,
                snapshot=registry_snapshot,
            ),
        )

        request = captured[0]["request"]
        assert request.condition_facts == {"front_door": True}
        assert request.trigger_source == "change"

    async def test_label_target_resolves_native_mobile_service(
        self, notification_alert, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["target"] = {"label_id": ["critical"]}
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            snapshot=registry_snapshot,
        )

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            capabilities.snapshot,
            capabilities.render,
        )

        assert [command.service for command in result] == ["mobile_app_phone"]
        assert result[0].target is None

    async def test_mobile_notify_preserves_confirmation_action(
        self, notification_alert, registry_snapshot, snapshot
    ):
        configured_alert = notification_alert
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
        }
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            snapshot=registry_snapshot,
        )

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            capabilities.snapshot,
            capabilities.render,
            notification_actions=[{"action": "confirm_1", "title": "Acknowledge"}],
        )

        normalized = [
            {
                "domain": command.domain,
                "service": command.service,
                "data": command.data,
                "target": command.target,
            }
            for command in result
        ]

        assert normalized == snapshot
        NOTIFY_SERVICE_SCHEMA(result[0].data)

    async def test_confirmation_timeout_is_independent_of_reminders(
        self, notification_alert, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
            "reminders": {"enabled": False, "timeout": 600},
        }
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            snapshot=registry_snapshot,
        )

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            capabilities.snapshot,
            capabilities.render,
            notification_actions=[{"action": "confirm_1", "title": "Acknowledge"}],
        )

        assert result[0].data["data"]["timeout"] == 600

    async def test_zero_confirmation_timeout_disables_native_expiry(
        self, notification_alert, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
            "reminders": {"timeout": 0},
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            registry_snapshot,
            render,
            notification_actions=[{"action": "confirm_1", "title": "Acknowledge"}],
        )

        assert "timeout" not in result[0].data["data"]

    async def test_mobile_device_target_uses_mobile_service(
        self, notification_alert, real_target_registry, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["target"] = {
            "device_id": [real_target_registry.device_id]
        }
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            registry_snapshot,
            render,
            notification_actions=[{"action": "confirm_1", "title": "Acknowledge"}],
        )

        assert result[0].service == "mobile_app_phone"
        assert result[0].target is None
        assert "actions" in result[0].data["data"]

    async def test_multiple_confirmation_buttons_are_rendered(
        self, notification_alert, real_target_registry, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [
                {"id": "snooze", "label": "Snooze"},
                {"id": "escalate", "label": "Escalate"},
            ],
        }
        configured_alert["notification"]["target"] = {
            "device_id": [real_target_registry.device_id]
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            registry_snapshot,
            render,
            notification_actions=[
                {"action": "action_snooze", "title": "Snooze"},
                {"action": "action_escalate", "title": "Escalate"},
            ],
        )

        assert result[0].data["data"]["actions"] == [
            {"action": "action_snooze", "title": "Snooze"},
            {"action": "action_escalate", "title": "Escalate"},
        ]

    async def test_user_target_resolves_to_mobile_service(
        self, notification_alert, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["target"] = {"user_id": ["user_1"]}

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            registry_snapshot,
            render,
        )

        assert [command.service for command in result] == ["mobile_app_phone"]
        assert result[0].target is None

    async def test_registry_device_target_includes_confirmation_action(
        self, notification_alert, real_target_registry, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["target"] = {
            "device_id": [real_target_registry.device_id]
        }
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm!"}],
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            registry_snapshot,
            render,
            notification_actions=[
                {"action": "NC_CONFIRM_alert_1_test", "title": "Confirm!"}
            ],
        )

        assert result[0].service == "mobile_app_phone"
        assert result[0].target is None
        assert result[0].data["data"]["actions"] == [
            {"action": "NC_CONFIRM_alert_1_test", "title": "Confirm!"}
        ]

    async def test_confirmation_resolves_mobile_app_entity_target(
        self, notification_alert, real_target_registry, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["target"] = {
            "entity_id": [real_target_registry.notify_entity_id]
        }
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            registry_snapshot,
            render,
            notification_actions=[{"action": "confirm_1", "title": "Acknowledge"}],
        )

        assert result[0].service == "mobile_app_phone"
        assert result[0].target is None
        assert "actions" in result[0].data["data"]

    async def test_device_registry_target_uses_mobile_service_with_data(
        self,
        notification_alert,
        real_target_registry,
        registry_snapshot,
        snapshot,
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["target"] = {
            "device_id": [real_target_registry.device_id]
        }
        configured_alert["notification"]["data"] = {
            "image": "https://example.test/image"
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            registry_snapshot,
            render,
        )

        normalized = [
            {
                "domain": command.domain,
                "service": command.service,
                "data": command.data,
                "target": command.target,
            }
            for command in result
        ]

        assert normalized == snapshot

    async def test_generic_notify_does_not_receive_mobile_app_data(
        self, notification_alert, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["target"] = {"entity_id": ["notify.external"]}
        configured_alert["notification"]["data"] = {
            "image": "https://example.test/image"
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            registry_snapshot,
            render,
        )

        assert result[0].service == "send_message"
        assert "data" not in result[0].data
        NOTIFY_SERVICE_SCHEMA(result[0].data)

    async def test_confirmation_falls_back_to_generic_notify(
        self, notification_alert, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["target"] = {"entity_id": ["notify.external"]}
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            registry_snapshot,
            render,
            notification_actions=[{"action": "confirm_1", "title": "Acknowledge"}],
        )

        assert result[0].service == "send_message"
        assert result[0].target == {"entity_id": ["notify.external"]}
        assert "data" not in result[0].data

    async def test_send_workflow_clears_before_composing_replacement(
        self, notification_alert, registry_snapshot
    ):
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            snapshot=registry_snapshot,
        )

        result = await notifications.send_requested(
            notifications.NotificationRequest(
                runtime=AlertRuntimeState.for_alert(notification_alert),
                replace_existing=True,
            ),
            capabilities,
        )

        assert len(result) == 2
        assert result[0].service == "mobile_app_phone"
        assert result[0].data["message"] == "clear_notification"
        assert result[0].data["data"] == {"tag": "ha_notifications_alert_1"}
        assert result[1].service == "mobile_app_phone"

    async def test_clear_uses_mobile_service_and_tag_for_mobile_device(
        self, notification_alert, real_target_registry, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["target"] = {
            "device_id": [real_target_registry.device_id]
        }

        result = await notifications.plan_clear(
            notifications.NotificationClearRequest(
                AlertRuntimeState.for_alert(configured_alert),
            ),
            registry_snapshot,
            render,
        )

        assert result[0].service == "mobile_app_phone"
        assert result[0].target is None
        assert result[0].data == {
            "message": "clear_notification",
            "data": {"tag": "ha_notifications_alert_1"},
        }

    async def test_clear_skips_generic_target(
        self, notification_alert, registry_snapshot
    ):
        configured_alert = notification_alert
        configured_alert["notification"]["target"] = {"entity_id": ["notify.external"]}

        result = await notifications.plan_clear(
            notifications.NotificationClearRequest(
                AlertRuntimeState.for_alert(configured_alert),
            ),
            registry_snapshot,
            render,
        )

        assert result == []


async def test_mobile_replacement_contract_snapshot(
    snapshot, notification_alert, registry_snapshot
):
    result = await notifications.send_requested(
        notifications.NotificationRequest(
            runtime=AlertRuntimeState.for_alert(notification_alert),
            replace_existing=True,
            notification_actions=({"action": "confirm_1", "title": "Confirm"},),
        ),
        notifications.NotificationCapabilitySet(
            render=render,
            snapshot=registry_snapshot,
        ),
    )
    normalized = [
        {
            "domain": command.domain,
            "service": command.service,
            "data": command.data,
            "target": command.target,
        }
        for command in result
    ]

    assert normalized == snapshot


async def test_confirmation_reminder_replacement_contract_snapshot(
    snapshot, confirmation_alert, registry_snapshot
):
    runtime = AlertRuntimeState.for_alert(confirmation_alert)
    runtime.confirmation.attempts = 1
    runtime.confirmation.action_ids = {"confirm": "confirm"}
    result = await notifications.send_requested(
        notifications.NotificationRequest(
            runtime=runtime,
            replace_existing=True,
            notification_actions=({"action": "confirm_1", "title": "Confirm"},),
        ),
        notifications.NotificationCapabilitySet(
            render=render,
            snapshot=registry_snapshot,
        ),
    )
    normalized = [
        {
            "domain": command.domain,
            "service": command.service,
            "data": command.data,
            "target": command.target,
        }
        for command in result
    ]

    assert normalized == snapshot


async def test_confirmation_completion_planner_renders_message_and_clear_policy(
    notification_alert, snapshot
):
    configured_alert = notification_alert
    configured_alert["confirmation"] = {
        "enabled": True,
        "notification": {
            "enabled": True,
            "message": (
                "{{confirmed_by}} finished ({{ request.confirmation.confirmed_by }})"
            ),
            "clear": False,
        },
    }

    captured = {}

    async def render_confirmation(source, variables):
        captured.update(variables)
        return source.replace(
            "{{confirmed_by}}",
            variables["confirmed_by"],
        ).replace(
            "{{ request.confirmation.confirmed_by }}",
            variables["request"].confirmation.confirmed_by,
        )

    plan = await notifications.ConfirmationDeliveryPlanner(
        configured_alert,
        ConfirmationContext(
            "Alice", ConfirmationSelection("action", "confirm", "Done")
        ),
        "now",
    ).build(render_confirmation)

    assert {
        "clear_notification": plan.clear_notification,
        "completion_alert": plan.completion_alert,
        "render_context": {
            "confirmed_by": captured["confirmed_by"],
            "request_confirmed_by": captured["request"].confirmation.confirmed_by,
        },
    } == snapshot


async def test_confirmation_completion_uses_generic_notify_target(
    notification_alert, registry_snapshot, snapshot
):
    configured_alert = notification_alert
    configured_alert["notification"]["target"] = {"entity_id": ["notify.external"]}
    configured_alert["confirmation"] = {
        "enabled": True,
        "notification": {
            "enabled": True,
            "message": "Confirmed",
            "clear": True,
        },
    }

    plan = await notifications.ConfirmationDeliveryPlanner(
        configured_alert,
        ConfirmationContext(
            "Alice", ConfirmationSelection("action", "confirm", "Done")
        ),
        "now",
    ).build(render)
    commands = await notifications.plan_delivery(
        notification_request(plan.completion_alert),
        registry_snapshot,
        render,
    )

    assert len(commands) == 1
    normalized = [
        {
            "domain": command.domain,
            "service": command.service,
            "data": command.data,
            "target": command.target,
        }
        for command in commands
    ]

    assert normalized == snapshot


async def test_notification_planner_rejects_missing_target(
    notification_alert, registry_snapshot
):
    configured_alert = notification_alert
    configured_alert["notification"]["target"] = None

    with pytest.raises(ValueError):
        await notifications.plan_delivery(
            notification_request(configured_alert),
            registry_snapshot,
            render,
        )


async def test_notification_feature_executes_registered_service(hass):
    calls = async_mock_service(hass, "notify", "test")
    feature = notifications.NotificationFeature(hass, {}, None, None)
    call = notifications.HomeAssistantServiceCall(
        domain="notify",
        service="test",
        data={"message": "Hello"},
        target=None,
    )

    await feature._execute([call])

    assert calls[0].data == {"message": "Hello"}


async def test_notification_feature_send_and_clear_use_capabilities(
    hass, monkeypatch, notification_alert, registry_snapshot
):
    feature = notifications.NotificationFeature(hass, {}, None, None)
    capabilities = notifications.NotificationCapabilitySet(
        render=render,
        snapshot=registry_snapshot,
    )
    sent = []

    async def execute(calls):
        sent.extend(calls)

    monkeypatch.setattr(feature, "capabilities", lambda: capabilities)
    monkeypatch.setattr(feature, "_execute", execute)

    result = await feature.send(
        notifications.NotificationRequest(
            runtime=AlertRuntimeState.for_alert(notification_alert),
            replace_existing=False,
        )
    )
    assert result.success
    await feature.clear(notification_alert)
    assert len(sent) == 2


async def test_send_requested_propagates_or_swallows_planning_errors(
    monkeypatch, notification_alert, registry_snapshot
):
    async def fail(*_args, **_kwargs):
        raise ValueError("invalid delivery")

    monkeypatch.setattr(notifications, "plan_delivery", fail)
    request = notifications.NotificationRequest(
        runtime=AlertRuntimeState.for_alert(notification_alert),
        replace_existing=False,
    )
    capabilities = notifications.NotificationCapabilitySet(
        render=render, snapshot=registry_snapshot
    )

    assert await notifications.send_requested(request, capabilities) == []
    with pytest.raises(ValueError):
        await notifications.send_requested(request, capabilities, propagate_errors=True)


async def test_confirmation_planner_accepts_canonical_alert_entity():
    configured_alert = Alert.model_validate(
        {
            "id": "alert_1",
            "name": "Alert",
            "notification": {
                "message": "Original",
                "target": {"entity_id": ["notify.external"]},
            },
            "confirmation": {
                "enabled": True,
                "notification": {"enabled": True, "message": "Completed"},
            },
        }
    )
    context = ConfirmationContext(
        "user_1", ConfirmationSelection("action_1", "confirm", "Done")
    )

    result = await notifications.ConfirmationDeliveryPlanner(
        configured_alert, context, "now"
    ).build(render)

    assert result.completion_alert is not None
    assert result.completion_alert["notification"]["message"] == "Completed"
    assert result.completion_alert["confirmation"] == {"enabled": False}


async def test_notification_feature_returns_failed_outcome_for_planning_error(
    monkeypatch, notification_alert, registry_snapshot
):
    feature = notifications.NotificationFeature(None, {}, None, None)
    monkeypatch.setattr(
        feature,
        "capabilities",
        lambda: notifications.NotificationCapabilitySet(
            render=render,
            snapshot=registry_snapshot,
        ),
    )

    async def fail(*_args, **_kwargs):
        raise ValueError("invalid delivery")

    monkeypatch.setattr(notifications, "send_requested", fail)
    result = await feature.send(
        notifications.NotificationRequest(
            runtime=AlertRuntimeState.for_alert(notification_alert),
            replace_existing=False,
        )
    )

    assert not result.success
    assert result.error == "invalid delivery"
