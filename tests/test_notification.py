"""Unit tests for controller/notifications.py - pure send/clear composition."""

from __future__ import annotations

import importlib
import unittest

from test_support import PACKAGE_NAME, ensure_package

ensure_package()
notifications = importlib.import_module(
    f"{PACKAGE_NAME}.features.notification"
)


class FakeEntity:
    def __init__(
        self, entity_id, device_id=None, area_id=None, config_entry_id=None, labels=None
    ):
        self.entity_id = entity_id
        self.device_id = device_id
        self.area_id = area_id
        self.config_entry_id = config_entry_id
        self.labels = labels or set()


class FakeDevice:
    def __init__(
        self,
        id,
        area_id=None,
        config_entries=None,
        labels=None,
        name=None,
        name_by_user=None,
    ):
        self.id = id
        self.area_id = area_id
        self.config_entries = config_entries or set()
        self.labels = labels or set()
        self.name = name
        self.name_by_user = name_by_user


class FakeArea:
    def __init__(self, area_id, floor_id=None):
        self.area_id = area_id
        self.floor_id = floor_id


class FakeEntityRegistry:
    def __init__(self, entities=()):
        self.entities = {entity.entity_id: entity for entity in entities}


class FakeDeviceRegistry:
    def __init__(self, devices=()):
        self.devices = {device.id: device for device in devices}


class FakeAreaRegistry:
    def __init__(self, areas=()):
        self.areas = {area.area_id: area for area in areas}


def empty_snapshot(
    entities=(), devices=(), areas=(), mobile_app_entries=(), person_states=()
):
    return notifications.RegistrySnapshot(
        area_registry=FakeAreaRegistry(areas),
        device_registry=FakeDeviceRegistry(devices),
        entity_registry=FakeEntityRegistry(entities),
        mobile_app_entries=list(mobile_app_entries),
        mobile_app_entry_ids={entry.entry_id for entry in mobile_app_entries},
        person_states=list(person_states),
    )


async def render(source, variables):
    return source


def has_service_false(domain, service):
    return False


def _alert(**overrides):
    base = {
        "id": "alert_1",
        "name": "Alert",
        "notification": {
            "action": "notify.mobile_app_phone",
            "target": {},
            "title": "Title",
            "message": "Message",
            "confirmation": {"enabled": False},
        },
    }
    base.update(overrides)
    return base


class ComposeSendTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_target_has_no_delivery_route(self):
        alert = _alert()
        snapshot = empty_snapshot()
        with self.assertRaises(ValueError):
            await notifications.compose_send(
                alert, {}, None, snapshot, render, has_service_false
            )

    async def test_generic_notify_route(self):
        alert = _alert(
            notification={
                "action": "notify.send_message",
                "target": {"entity_id": ["notify.somebody"]},
                "title": "T",
                "message": "M",
                "confirmation": {"enabled": False},
            }
        )
        snapshot = empty_snapshot()
        result = await notifications.compose_send(
            alert, {}, None, snapshot, render, has_service_false
        )
        self.assertEqual(result[0].service, "send_message")

    async def test_legacy_mobile_app_resolution_used_when_available(self):
        device = FakeDevice("device_1", config_entries={"entry_1"}, name="My Phone")
        entity = FakeEntity("notify.mobile_app_phone", device_id="device_1")

        class FakeEntry:
            entry_id = "entry_1"
            data = {}
            title = "My Phone"

        snapshot = empty_snapshot(
            entities=[entity], devices=[device], mobile_app_entries=[FakeEntry()]
        )

        def has_service_true(domain, service):
            return service == "mobile_app_my_phone"

        alert = _alert(
            notification={
                "action": "notify.send_message",
                "target": {"device_id": ["device_1"]},
                "title": "T",
                "message": "M",
                "confirmation": {"enabled": False},
            }
        )
        result = await notifications.compose_send(
            alert, {}, None, snapshot, render, has_service_true
        )
        self.assertEqual(result[0].service, "mobile_app_my_phone")

    async def test_mixed_direct_recipients_report_unresolved_recipient(self):
        valid_device = FakeDevice("device_1", config_entries={"entry_1"}, name="Phone")
        invalid_device = FakeDevice("device_2", name="Tablet")
        entity = FakeEntity("notify.mobile_app_phone", device_id="device_1")

        class FakeEntry:
            entry_id = "entry_1"
            data = {}
            title = "Phone"

        snapshot = empty_snapshot(
            entities=[entity],
            devices=[valid_device, invalid_device],
            mobile_app_entries=[FakeEntry()],
        )
        alert = _alert(
            notification={
                "action": "notify.send_message",
                "target": {"device_id": ["device_1", "device_2"]},
                "title": "T",
                "message": "M",
                "confirmation": {"enabled": False},
            }
        )

        result = await notifications.compose_send(
            alert,
            {},
            None,
            snapshot,
            render,
            lambda domain, service: service == "mobile_app_phone",
        )
        self.assertEqual(result[0].service, "send_message")
        self.assertEqual(result[0].target, {"device_id": ["device_1", "device_2"]})

    async def test_confirmation_requires_resolved_mobile_app_route(self):
        alert = _alert(
            notification={
                "action": "notify.send_message",
                "target": {},
                "title": "T",
                "message": "M",
                "confirmation": {"enabled": True, "button": "Ack"},
            }
        )
        snapshot = empty_snapshot()
        with self.assertRaises(ValueError):
            await notifications.compose_send(
                alert, {}, "action_1", snapshot, render, has_service_false
            )

    async def test_confirmation_button_appended_when_route_supports_it(self):
        device = FakeDevice("device_1", config_entries={"entry_1"}, name="Phone")
        entity = FakeEntity("notify.mobile_app_phone", device_id="device_1")

        class FakeEntry:
            entry_id = "entry_1"
            data = {}
            title = "Phone"

        snapshot = empty_snapshot(
            entities=[entity], devices=[device], mobile_app_entries=[FakeEntry()]
        )

        def has_service_true(domain, service):
            return service == "mobile_app_phone"

        alert = _alert(
            notification={
                "action": "notify.mobile_app_phone",
                "target": {"device_id": ["device_1"]},
                "title": "T",
                "message": "M",
                "confirmation": {"enabled": True, "button": "Ack"},
            }
        )
        result = await notifications.compose_send(
            alert, {}, "action_1", snapshot, render, has_service_true
        )
        actions = result[0].data["data"]["actions"]
        self.assertEqual(actions[0]["action"], "action_1")
        self.assertEqual(actions[0]["title"], "Ack")

    async def test_no_valid_route_raises(self):
        alert = _alert(
            notification={
                "action": "",
                "target": {},
                "title": "T",
                "message": "M",
                "confirmation": {},
            }
        )
        snapshot = empty_snapshot()
        with self.assertRaises(ValueError):
            await notifications.compose_send(
                alert, {}, None, snapshot, render, has_service_false
            )

    def test_recipient_resolution_summary_names_invalid_recipient(self):
        summary = notifications._recipient_resolution_summary(
            empty_snapshot(), {"device_id": ["device_1"]}, has_service_false
        )
        self.assertEqual(
            summary,
            "Invalid: device_id 'device_1' (no notification-capable device found).",
        )


class ComposeClearTests(unittest.IsolatedAsyncioTestCase):
    async def test_clear_without_target_returns_no_commands(self):
        alert = _alert(
            notification={
                "action": "notify.send_message",
                "target": {},
                "title": "",
                "message": "",
            }
        )
        snapshot = empty_snapshot()
        result = await notifications.compose_clear(
            alert, {}, snapshot, render, has_service_false
        )
        self.assertEqual(result, [])

    async def test_clear_with_no_matching_route_returns_no_commands(self):
        alert = _alert(
            notification={
                "action": "script.turn_on",
                "target": {},
                "title": "",
                "message": "",
            }
        )
        snapshot = empty_snapshot()
        result = await notifications.compose_clear(
            alert, {}, snapshot, render, has_service_false
        )
        self.assertEqual(result, [])


class NotificationWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_send_workflow_clears_before_composing_replacement(self):
        alert = _alert(
            notification={
                "action": "notify.send_message",
                "target": {"entity_id": ["notify.somebody"]},
                "title": "T",
                "message": "M",
                "confirmation": {"enabled": False},
            }
        )
        capabilities = notifications.NotificationCapabilitySet(
            render=render,
            has_service=has_service_false,
            snapshot=empty_snapshot(),
        )

        result = await notifications.send_requested(
            {
                "alert": alert,
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
