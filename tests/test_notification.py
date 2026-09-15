"""Tests for the feature-owned notification workflow."""

from __future__ import annotations

import importlib
import unittest
from types import SimpleNamespace

from test_support import PACKAGE_NAME, ensure_package

ensure_package()
notifications = importlib.import_module(f"{PACKAGE_NAME}.features.notification")


async def render(source, _variables):
    return source


def has_service_false(_domain, _service):
    return False


def has_mobile_app_service(_domain, service):
    return service in {"mobile_app_phone", "mobile_app_tablet"}


def empty_snapshot():
    return notifications.RegistrySnapshot(
        area_registry=SimpleNamespace(areas={}),
        device_registry=SimpleNamespace(devices={}),
        entity_registry=SimpleNamespace(entities={}),
        mobile_app_entries=[],
        mobile_app_entry_ids=set(),
        person_states=[],
    )


def labeled_mobile_app_snapshot():
    return notifications.RegistrySnapshot(
        area_registry=SimpleNamespace(areas={}),
        device_registry=SimpleNamespace(
            devices={
                "device_phone": SimpleNamespace(
                    id="device_phone",
                    area_id=None,
                    labels={"critical"},
                    config_entries={"mobile_phone"},
                ),
                "device_tablet": SimpleNamespace(
                    id="device_tablet",
                    area_id=None,
                    labels={"critical"},
                    config_entries={"mobile_tablet"},
                ),
            }
        ),
        entity_registry=SimpleNamespace(entities={}),
        mobile_app_entries=[
            SimpleNamespace(
                entry_id="mobile_phone",
                title="Phone",
                data={},
            ),
            SimpleNamespace(
                entry_id="mobile_tablet",
                title="Tablet",
                data={},
            ),
        ],
        mobile_app_entry_ids={"mobile_phone", "mobile_tablet"},
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
    async def test_label_target_delivers_to_all_labeled_mobile_devices(self):
        configured_alert = alert()
        configured_alert["notification"]["target"] = {"label_id": ["critical"]}
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            has_service=has_mobile_app_service,
            snapshot=labeled_mobile_app_snapshot(),
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
            capabilities.has_service,
        )

        self.assertEqual(
            [command.service for command in result],
            ["mobile_app_phone", "mobile_app_tablet"],
        )

    async def test_send_workflow_clears_before_composing_replacement(self):
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            has_service=has_service_false,
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
        self.assertEqual(result[0].service, "send_message")
        self.assertEqual(result[0].data["message"], "clear_notification")
        self.assertEqual(result[1].service, "send_message")


if __name__ == "__main__":
    unittest.main()
