"""Tests for the feature-owned notification workflow."""

from __future__ import annotations

import importlib
import unittest
from functools import partial

from homeassistant.components.notify.const import NOTIFY_SERVICE_SCHEMA

from custom_components.ha_notifications.domain.confirmation import (
    ConfirmationContext,
    ConfirmationSelection,
)
from custom_components.ha_notifications.domain.runtime import AlertRuntimeState
from custom_components.ha_notifications.features.configuration import Alert
from tests.backend.conftest import (
    make_confirmation_alert,
    notification_snapshot,
    target_registry_snapshot,
)
from tests.backend.conftest import make_notification_alert as alert
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
notifications = importlib.import_module(f"{PACKAGE_NAME}.features.notification")

mobile_snapshot = partial(notification_snapshot, "mobile")
mobile_device_registry_snapshot = partial(notification_snapshot, "mobile_device")
empty_snapshot = partial(notification_snapshot, "empty")
labeled_device_snapshot = partial(notification_snapshot, "labeled")


async def render(source, _variables):
    return source


def notification_request(alert, *, condition_facts=None):
    return notifications.NotificationRequest(
        runtime=AlertRuntimeState.for_alert(alert),
        replace_existing=False,
        condition_facts=condition_facts or {},
    )


class NotificationWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_template_context_exposes_condition_facts_and_trigger(self):
        configured_alert = alert()
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
                snapshot=labeled_device_snapshot(),
            ),
        )

        request = captured[0]["request"]
        assert request.condition_facts == {"front_door": True}
        assert request.trigger_source == "change"

    async def test_label_target_uses_generic_notify_target(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {"label_id": ["critical"]}
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            snapshot=labeled_device_snapshot(),
        )

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            capabilities.snapshot,
            capabilities.render,
        )

        self.assertEqual([command.service for command in result], ["send_message"])
        self.assertEqual(result[0].target, {"label_id": ["critical"]})

    async def test_mobile_notify_preserves_confirmation_action(self):
        configured_alert = alert()
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
        }
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            snapshot=empty_snapshot(),
        )

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            capabilities.snapshot,
            capabilities.render,
            notification_actions=[
                {"action": "confirm_1", "title": "Acknowledge"}
            ],
        )

        self.assertEqual(result[0].service, "mobile_app_somebody")
        self.assertIsNone(result[0].target)
        self.assertEqual(
            result[0].data["data"]["actions"],
            [{"action": "confirm_1", "title": "Acknowledge"}],
        )
        self.assertEqual(result[0].data["data"]["timeout"], 900)
        self.assertEqual(result[0].data["data"]["tag"], "ha_notifications_alert_1")
        NOTIFY_SERVICE_SCHEMA(result[0].data)

    async def test_confirmation_timeout_is_independent_of_reminders(self):
        configured_alert = alert()
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
            "reminders": {"enabled": False, "timeout": 600},
        }
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            snapshot=empty_snapshot(),
        )

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            capabilities.snapshot,
            capabilities.render,
            notification_actions=[
                {"action": "confirm_1", "title": "Acknowledge"}
            ],
        )

        self.assertEqual(result[0].data["data"]["timeout"], 600)

    async def test_zero_confirmation_timeout_disables_native_expiry(self):
        configured_alert = alert()
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
            "reminders": {"timeout": 0},
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            empty_snapshot(),
            render,
            notification_actions=[
                {"action": "confirm_1", "title": "Acknowledge"}
            ],
        )

        self.assertNotIn("timeout", result[0].data["data"])

    async def test_mobile_device_target_uses_mobile_service(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {
            "device_id": ["phone_device"]
        }
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            mobile_snapshot(),
            render,
            notification_actions=[
                {"action": "confirm_1", "title": "Acknowledge"}
            ],
        )

        self.assertEqual(result[0].service, "mobile_app_somebody")
        self.assertIsNone(result[0].target)
        self.assertIn("actions", result[0].data["data"])

    async def test_multiple_confirmation_buttons_are_rendered(self):
        configured_alert = alert()
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [
                {"id": "snooze", "label": "Snooze"},
                {"id": "escalate", "label": "Escalate"},
            ],
        }
        configured_alert["notification"]["target"] = {
            "device_id": ["phone_device"]
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            mobile_device_registry_snapshot(),
            render,
            notification_actions=[
                {"action": "action_snooze", "title": "Snooze"},
                {"action": "action_escalate", "title": "Escalate"},
            ],
        )

        self.assertEqual(
            result[0].data["data"]["actions"],
            [
                {"action": "action_snooze", "title": "Snooze"},
                {"action": "action_escalate", "title": "Escalate"},
            ],
        )

    async def test_user_target_resolves_to_mobile_service(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {"user_id": ["user_1"]}

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            target_registry_snapshot(),
            render,
        )

        self.assertEqual([command.service for command in result], ["mobile_app_phone"])
        self.assertIsNone(result[0].target)

    async def test_registry_device_target_includes_confirmation_action(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {
            "device_id": ["phone_device"]
        }
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm!"}],
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            mobile_device_registry_snapshot(),
            render,
            notification_actions=[
                {"action": "NC_CONFIRM_alert_1_test", "title": "Confirm!"}
            ],
        )

        self.assertEqual(result[0].service, "mobile_app_somebody")
        self.assertIsNone(result[0].target)
        self.assertEqual(
            result[0].data["data"]["actions"],
            [{"action": "NC_CONFIRM_alert_1_test", "title": "Confirm!"}],
        )

    async def test_confirmation_resolves_mobile_app_entity_target(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {
            "entity_id": ["notify.mobile_app_somebody"]
        }
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            mobile_snapshot(),
            render,
            notification_actions=[
                {"action": "confirm_1", "title": "Acknowledge"}
            ],
        )

        self.assertEqual(result[0].service, "mobile_app_somebody")
        self.assertIsNone(result[0].target)
        self.assertIn("actions", result[0].data["data"])

    async def test_device_registry_target_uses_mobile_service_with_data(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {
            "device_id": ["phone_device"]
        }
        configured_alert["notification"]["data"] = {
            "image": "https://example.test/image"
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            mobile_device_registry_snapshot(),
            render,
        )

        self.assertEqual(result[0].service, "mobile_app_somebody")
        self.assertIsNone(result[0].target)
        self.assertEqual(
            result[0].data["data"],
            {
                "image": "https://example.test/image",
                "tag": "ha_notifications_alert_1",
            },
        )

    async def test_generic_notify_does_not_receive_mobile_app_data(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {
            "entity_id": ["notify.external"]
        }
        configured_alert["notification"]["data"] = {"image": "https://example.test/image"}

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            labeled_device_snapshot(),
            render,
        )

        self.assertEqual(result[0].service, "send_message")
        self.assertNotIn("data", result[0].data)
        NOTIFY_SERVICE_SCHEMA(result[0].data)

    async def test_confirmation_falls_back_to_generic_notify(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {
            "entity_id": ["notify.external"]
        }
        configured_alert["confirmation"] = {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Acknowledge"}],
        }

        result = await notifications.plan_delivery(
            notification_request(configured_alert),
            labeled_device_snapshot(),
            render,
            notification_actions=[
                {"action": "confirm_1", "title": "Acknowledge"}
            ],
        )

        self.assertEqual(result[0].service, "send_message")
        self.assertEqual(result[0].target, {"entity_id": ["notify.external"]})
        self.assertNotIn("data", result[0].data)

    async def test_send_workflow_clears_before_composing_replacement(self):
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            snapshot=empty_snapshot(),
        )

        result = await notifications.send_requested(
            notifications.NotificationRequest(
                runtime=AlertRuntimeState.for_alert(alert()),
                replace_existing=True,
            ),
            capabilities,
        )

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].service, "mobile_app_somebody")
        self.assertEqual(result[0].data["message"], "clear_notification")
        self.assertEqual(
            result[0].data["data"],
            {"tag": "ha_notifications_alert_1"},
        )
        self.assertEqual(result[1].service, "mobile_app_somebody")

    async def test_clear_uses_mobile_service_and_tag_for_mobile_device(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {
            "device_id": ["phone_device"]
        }

        result = await notifications.plan_clear(
            notifications.NotificationClearRequest(
                AlertRuntimeState.for_alert(configured_alert),
            ),
            mobile_snapshot(),
            render,
        )

        self.assertEqual(result[0].service, "mobile_app_somebody")
        self.assertIsNone(result[0].target)
        self.assertEqual(
            result[0].data,
            {
                "message": "clear_notification",
                "data": {"tag": "ha_notifications_alert_1"},
            },
        )

    async def test_clear_skips_generic_target(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {
            "entity_id": ["notify.external"]
        }

        result = await notifications.plan_clear(
            notifications.NotificationClearRequest(
                AlertRuntimeState.for_alert(configured_alert),
            ),
            labeled_device_snapshot(),
            render,
        )

        self.assertEqual(result, [])


async def test_mobile_replacement_contract_snapshot(snapshot):
    result = await notifications.send_requested(
        notifications.NotificationRequest(
            runtime=AlertRuntimeState.for_alert(alert()),
            replace_existing=True,
            notification_actions=(
                {"action": "confirm_1", "title": "Confirm"}
            ,),
        ),
        notifications.NotificationCapabilitySet(
            render=render,
            snapshot=empty_snapshot(),
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


async def test_confirmation_reminder_replacement_contract_snapshot(snapshot):
    runtime = AlertRuntimeState.for_alert(make_confirmation_alert())
    runtime.confirmation.attempts = 1
    runtime.confirmation.action_ids = {"confirm": "confirm"}
    result = await notifications.send_requested(
        notifications.NotificationRequest(
            runtime=runtime,
            replace_existing=True,
            notification_actions=(
                {"action": "confirm_1", "title": "Confirm"}
            ,),
        ),
        notifications.NotificationCapabilitySet(
            render=render,
            snapshot=empty_snapshot(),
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


async def test_confirmation_completion_planner_renders_message_and_clear_policy():
    configured_alert = alert()
    configured_alert["confirmation"] = {
        "enabled": True,
        "notification": {
            "enabled": True,
            "message": (
                "{{confirmed_by}} finished "
                "({{ request.confirmation.confirmed_by }})"
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

    assert plan.clear_notification is False
    assert (
        plan.completion_alert["notification"]["message"]
        == "Alice finished (Alice)"
    )
    assert plan.completion_alert["confirmation"] == {"enabled": False}
    assert captured["confirmed_by"] == "Alice"
    assert captured["request"].confirmation.confirmed_by == "Alice"


async def test_confirmation_completion_uses_generic_notify_target():
    configured_alert = alert()
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
        labeled_device_snapshot(),
        render,
    )

    assert len(commands) == 1
    assert commands[0].service == "send_message"
    assert commands[0].target == {"entity_id": ["notify.external"]}
    assert commands[0].data["message"] == "Confirmed"


async def test_notification_planner_rejects_missing_target():
    configured_alert = alert()
    configured_alert["notification"]["target"] = None

    with unittest.TestCase().assertRaises(ValueError):
        await notifications.plan_delivery(
            notification_request(configured_alert),
            empty_snapshot(),
            render,
        )


async def test_notification_feature_executes_registered_service(hass):
    calls = []

    async def handler(call):
        calls.append(call)

    hass.services.async_register("notify", "test", handler)
    feature = notifications.NotificationFeature(hass, {}, None, None)
    call = notifications.HomeAssistantServiceCall(
        domain="notify",
        service="test",
        data={"message": "Hello"},
        target=None,
    )

    await feature._execute([call])

    assert calls[0].data == {"message": "Hello"}


async def test_notification_feature_send_and_clear_use_capabilities(hass, monkeypatch):
    feature = notifications.NotificationFeature(hass, {}, None, None)
    capabilities = notifications.NotificationCapabilitySet(
        render=render,
        snapshot=empty_snapshot(),
    )
    sent = []

    async def execute(calls):
        sent.extend(calls)

    monkeypatch.setattr(feature, "capabilities", lambda: capabilities)
    monkeypatch.setattr(feature, "_execute", execute)

    result = await feature.send(
        notifications.NotificationRequest(
            runtime=AlertRuntimeState.for_alert(alert()),
            replace_existing=False,
        )
    )
    assert result.success
    await feature.clear(alert())
    assert len(sent) == 2


async def test_send_requested_propagates_or_swallows_planning_errors(monkeypatch):
    async def fail(*_args, **_kwargs):
        raise ValueError("invalid delivery")

    monkeypatch.setattr(notifications, "plan_delivery", fail)
    request = notifications.NotificationRequest(
        runtime=AlertRuntimeState.for_alert(alert()),
        replace_existing=False,
    )
    capabilities = notifications.NotificationCapabilitySet(
        render=render, snapshot=empty_snapshot()
    )

    assert await notifications.send_requested(request, capabilities) == []
    with unittest.TestCase().assertRaises(ValueError):
        await notifications.send_requested(
            request, capabilities, propagate_errors=True
        )


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
    monkeypatch,
):
    feature = notifications.NotificationFeature(None, {}, None, None)
    monkeypatch.setattr(
        feature,
        "capabilities",
        lambda: notifications.NotificationCapabilitySet(
            render=render,
            snapshot=empty_snapshot(),
        ),
    )

    async def fail(*_args, **_kwargs):
        raise ValueError("invalid delivery")

    monkeypatch.setattr(notifications, "send_requested", fail)
    result = await feature.send(
        notifications.NotificationRequest(
            runtime=AlertRuntimeState.for_alert(alert()),
            replace_existing=False,
        )
    )

    assert not result.success
    assert result.error == "invalid delivery"


if __name__ == "__main__":
    unittest.main()
