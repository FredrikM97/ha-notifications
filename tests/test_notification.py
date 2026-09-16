"""Tests for the feature-owned notification workflow."""

from __future__ import annotations

import importlib
import unittest
from types import SimpleNamespace

from homeassistant.components.notify.const import NOTIFY_SERVICE_SCHEMA
from test_support import PACKAGE_NAME, ensure_package

ensure_package()
notifications = importlib.import_module(f"{PACKAGE_NAME}.features.notification")


async def render(source, _variables):
    return source


def mobile_snapshot():
    return notifications.RegistrySnapshot(
        area_registry=SimpleNamespace(areas={}),
        device_registry=SimpleNamespace(devices={}),
        entity_registry=SimpleNamespace(entities={}),
        mobile_app_entries=[
            SimpleNamespace(
                entry_id="mobile_entry",
                data={"device_id": "phone_device", "device_name": "somebody"},
            )
        ],
        person_states=[],
    )


def mobile_device_registry_snapshot():
    return notifications.RegistrySnapshot(
        area_registry=SimpleNamespace(areas={}),
        device_registry=SimpleNamespace(
            devices={
                "phone_device": SimpleNamespace(
                    id="phone_device",
                    area_id=None,
                    labels=set(),
                    config_entries={"mobile_entry"},
                )
            }
        ),
        entity_registry=SimpleNamespace(entities={}),
        mobile_app_entries=[
            SimpleNamespace(
                entry_id="mobile_entry",
                data={"device_name": "somebody"},
            )
        ],
        person_states=[],
    )


def empty_snapshot():
    return notifications.RegistrySnapshot(
            area_registry=SimpleNamespace(areas={}),
            device_registry=SimpleNamespace(devices={}),
            entity_registry=SimpleNamespace(
                entities={
                    "notify.somebody": SimpleNamespace(
                        entity_id="notify.somebody",
                        device_id=None,
                        config_entry_id="mobile_entry",
                        area_id=None,
                        labels=set(),
                    )
                }
            ),
        mobile_app_entries=[
            SimpleNamespace(
                entry_id="mobile_entry",
                data={"device_name": "somebody"},
            )
        ],
        person_states=[],
    )


def labeled_device_snapshot():
    return notifications.RegistrySnapshot(
            area_registry=SimpleNamespace(areas={}),
            device_registry=SimpleNamespace(devices={}),
            entity_registry=SimpleNamespace(entities={}),
        mobile_app_entries=[],
        person_states=[],
    )


def alert():
    return {
        "id": "alert_1",
        "name": "Alert",
        "notification": {
            "action": "notify.send_message",
            "target": {"entity_id": ["notify.somebody"]},
            "title": "Title",
            "message": "Message",
        },
        "confirmation": {"enabled": False},
    }


class NotificationWorkflowTests(unittest.IsolatedAsyncioTestCase):
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


if __name__ == "__main__":
    unittest.main()
