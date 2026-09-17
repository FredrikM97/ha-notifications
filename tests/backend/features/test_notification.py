"""Tests for the feature-owned notification workflow."""

from __future__ import annotations

import importlib
import unittest
from datetime import datetime, timezone
from functools import partial

from homeassistant.components.notify.const import NOTIFY_SERVICE_SCHEMA

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


class NotificationWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_template_context_exposes_condition_facts_and_trigger(self):
        configured_alert = alert()
        configured_alert["notification"]["message"] = "{{ condition.front_door }}"
        captured: list[dict[str, object]] = []

        async def capture_render(source, variables):
            captured.append(variables)
            return source

        await notifications.send_requested(
            {
                "alert": configured_alert,
                "alert_id": "alert_1",
                "alert_name": "Alert",
                "attempt": 1,
                "condition_facts": {"front_door": True},
                "trigger_source": "change",
                "now": datetime(2026, 1, 1, tzinfo=timezone.utc),
            },
            notifications.NotificationCapabilitySet(
                render=capture_render,
                snapshot=labeled_device_snapshot(),
            ),
        )

        assert any(
            values.get("condition") == {"front_door": True}
            and values.get("trigger") == "change"
            for values in captured
        )

    async def test_label_target_uses_generic_notify_target(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {"label_id": ["critical"]}
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            snapshot=labeled_device_snapshot(),
        )

        result = await notifications.plan_delivery(
            configured_alert,
            {
                "alert_id": "alert_1",
                "alert_name": "Alert",
                "attempt": 1,
            },
            None,
            capabilities.snapshot,
            capabilities.render,
        )

        self.assertEqual([command.service for command in result], ["send_message"])
        self.assertEqual(result[0].target, {"label_id": ["critical"]})

    async def test_mobile_notify_preserves_confirmation_action(self):
        configured_alert = alert()
        configured_alert["confirmation"] = {
            "enabled": True,
            "button": "Acknowledge",
        }
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            snapshot=empty_snapshot(),
        )

        result = await notifications.plan_delivery(
            configured_alert,
            {
                "alert_id": "alert_1",
                "alert_name": "Alert",
                "attempt": 1,
            },
            "confirm_1",
            capabilities.snapshot,
            capabilities.render,
        )

        self.assertEqual(result[0].service, "mobile_app_somebody")
        self.assertIsNone(result[0].target)
        self.assertEqual(
            result[0].data["data"]["actions"],
            [{"action": "confirm_1", "title": "Acknowledge"}],
        )
        self.assertEqual(result[0].data["data"]["tag"], "ha_notifications_alert_1")
        NOTIFY_SERVICE_SCHEMA(result[0].data)

    async def test_mobile_device_target_uses_mobile_service(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {
            "device_id": ["phone_device"]
        }
        configured_alert["confirmation"] = {
            "enabled": True,
            "button": "Acknowledge",
        }

        result = await notifications.plan_delivery(
            configured_alert,
            {"alert_id": "alert_1", "alert_name": "Alert", "attempt": 1},
            "confirm_1",
            mobile_snapshot(),
            render,
        )

        self.assertEqual(result[0].service, "mobile_app_somebody")
        self.assertIsNone(result[0].target)
        self.assertIn("actions", result[0].data["data"])

    async def test_user_target_resolves_to_mobile_service(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {"user_id": ["user_1"]}

        result = await notifications.plan_delivery(
            configured_alert,
            {"alert_id": "alert_1", "alert_name": "Alert", "attempt": 1},
            None,
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
            "button": "Confirm!",
        }

        result = await notifications.plan_delivery(
            configured_alert,
            {"alert_id": "alert_1", "alert_name": "Alert", "attempt": 1},
            "NC_CONFIRM_alert_1_test",
            mobile_device_registry_snapshot(),
            render,
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
            "button": "Acknowledge",
        }

        result = await notifications.plan_delivery(
            configured_alert,
            {"alert_id": "alert_1", "alert_name": "Alert", "attempt": 1},
            "confirm_1",
            mobile_snapshot(),
            render,
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
            configured_alert,
            {"alert_id": "alert_1", "alert_name": "Alert", "attempt": 1},
            None,
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
            configured_alert,
            {"alert_id": "alert_1", "alert_name": "Alert", "attempt": 1},
            None,
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
            "button": "Acknowledge",
        }

        result = await notifications.plan_delivery(
            configured_alert,
            {"alert_id": "alert_1", "alert_name": "Alert", "attempt": 1},
            "confirm_1",
            labeled_device_snapshot(),
            render,
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
            {
                "alert": alert(),
                "attempt": 1,
                "confirmation_action_id": None,
                "replace_existing": True,
                "now": "now",
            },
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
            configured_alert,
            {"alert_id": "alert_1"},
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
            configured_alert,
            {"alert_id": "alert_1"},
            labeled_device_snapshot(),
            render,
        )

        self.assertEqual(result, [])


async def test_mobile_replacement_contract_snapshot(snapshot):
    result = await notifications.send_requested(
        {
            "alert": alert(),
            "attempt": 2,
            "confirmation_action_id": "confirm_1",
            "replace_existing": True,
            "test": True,
            "now": "now",
        },
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
    result = await notifications.send_requested(
        {
            "alert": make_confirmation_alert(),
            "attempt": 2,
            "confirmation_action_id": "confirm_1",
            "replace_existing": True,
            "test": False,
            "now": "now",
        },
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


def test_delivery_result_commits_only_successful_attempts():
    runtime = {
        "attempts": 1,
        "last_notified": "previous",
        "last_error": None,
    }

    notifications.NotificationFeature.record_delivery_result(
        runtime,
        2,
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        success=False,
        error="delivery failed",
    )

    assert runtime == {
        "attempts": 1,
        "last_notified": "previous",
        "last_error": "delivery failed",
    }

    notifications.NotificationFeature.record_delivery_result(
        runtime,
        2,
        datetime(2026, 1, 2, tzinfo=timezone.utc),
        success=True,
    )

    assert runtime == {
        "attempts": 2,
        "last_notified": "2026-01-02T00:00:00+00:00",
        "last_error": None,
    }


async def test_confirmation_completion_planner_renders_message_and_clear_policy():
    configured_alert = alert()
    configured_alert["confirmation"] = {
        "enabled": True,
        "notification": {
            "enabled": True,
            "message": "{{ confirmed_by }} finished",
            "clear": False,
        },
    }

    captured = {}

    async def render_confirmation(source, variables):
        captured.update(variables)
        return source.replace("{{ confirmed_by }}", variables["confirmed_by"])

    plan = await notifications.ConfirmationDeliveryPlanner(
        configured_alert, "Alice", "now"
    ).build(render_confirmation)

    assert plan.clear_notification is False
    assert plan.completion_alert["notification"]["message"] == "Alice finished"
    assert plan.completion_alert["confirmation"] == {"enabled": False}
    assert captured["confirmed_by"] == "Alice"
    assert captured["trigger"] == "confirmation"
    assert captured["attempt"] == 1


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
        configured_alert, "Alice", "now"
    ).build(render)
    commands = await notifications.plan_delivery(
        plan.completion_alert,
        {"alert_id": "alert_1", "alert_name": "Alert", "attempt": 1},
        None,
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
            configured_alert,
            {"alert_id": "alert_1", "alert_name": "Alert", "attempt": 1},
            None,
            empty_snapshot(),
            render,
        )


async def test_notification_feature_executes_registered_service(hass):
    calls = []

    async def handler(call):
        calls.append(call)

    hass.services.async_register("notify", "test", handler)
    feature = notifications.NotificationFeature(hass, {}, None, None)
    call = notifications.ServiceCall(
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

    assert await feature.send(
        {
            "alert": alert(),
            "attempt": 1,
            "confirmation_action_id": None,
            "replace_existing": False,
            "now": "now",
        }
    )
    await feature.clear(alert(), "now")
    assert len(sent) == 2


async def test_send_requested_propagates_or_swallows_planning_errors(monkeypatch):
    async def fail(*_args, **_kwargs):
        raise ValueError("invalid delivery")

    monkeypatch.setattr(notifications, "plan_delivery", fail)
    payload = {
        "alert": alert(),
        "attempt": 1,
        "confirmation_action_id": None,
        "replace_existing": False,
        "now": "now",
    }
    capabilities = notifications.NotificationCapabilitySet(
        render=render, snapshot=empty_snapshot()
    )

    assert await notifications.send_requested(payload, capabilities) == []
    with unittest.TestCase().assertRaises(ValueError):
        await notifications.send_requested(
            {**payload, "propagate_errors": True}, capabilities
        )


if __name__ == "__main__":
    unittest.main()
