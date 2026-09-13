"""Tests for safe notification service payload construction."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import unittest

from test_support import load_notifications


notifications = load_notifications()


class NotificationPayloadTests(unittest.TestCase):
    class ServiceRecorder:
        def __init__(self):
            self.calls = []

        async def async_call(self, domain, service, **kwargs):
            self.calls.append((domain, service, kwargs))

    class Hass:
        def __init__(self, mobile_app_entries=(), entities=()):
            self.services = NotificationPayloadTests.ServiceRecorder()
            self.config_entries = type(
                "ConfigEntries",
                (),
                {
                    "async_entries": lambda _self, domain: (
                        mobile_app_entries if domain == "mobile_app" else []
                    )
                },
            )()
            self.entity_registry = type(
                "EntityRegistry",
                (),
                {"entities": {entity.entity_id: entity for entity in entities}},
            )()

    @staticmethod
    def mobile_app_entry(entry_id, user_id):
        return type(
            "ConfigEntry",
            (),
            {"entry_id": entry_id, "data": {"user_id": user_id}},
        )()

    @staticmethod
    def notify_entity(entity_id, config_entry_id):
        return type(
            "EntityEntry",
            (),
            {
                "entity_id": entity_id,
                "config_entry_id": config_entry_id,
            },
        )()

    class Storage:
        def __init__(self, config):
            self.config = config
            self.saved = []

        async def async_load_config(self):
            return self.config

        async def async_save_config(self, config):
            self.saved.append(config)
            self.config = config
            return config

    def test_remove_none_drops_nested_null_values(self):
        self.assertEqual(
            notifications._remove_none(
                {
                    "message": "Reminder",
                    "data": {
                        "tag": None,
                        "actions": [
                            {"action": "DONE", "title": None},
                            None,
                        ],
                    },
                }
            ),
            {
                "message": "Reminder",
                "data": {
                    "actions": [{"action": "DONE"}],
                },
            },
        )

    def test_confirmation_payload_matches_android_action_shape(self):
        hass = self.Hass()
        dispatcher = notifications.NotificationDispatcher(hass)
        alert = {
            "id": "water",
            "name": "Water reminder",
            "notification": {
                "action": "notify.mobile_app_phone",
                "target": {},
                "title": "Reminder",
                "message": "Has this been completed?",
                "data": {"tag": "water", "optional": None},
                "confirmation": {
                    "enabled": True,
                    "button": "Done",
                },
            },
        }

        asyncio.run(
            dispatcher.async_send(
                alert,
                attempt=1,
                confirmation_action_id="NC_CONFIRM_water_123",
                context=None,
                test=True,
            )
        )

        self.assertEqual(
            len(hass.services.calls),
            1,
        )
        domain, service, kwargs = hass.services.calls[0]
        self.assertEqual((domain, service), ("notify", "mobile_app_phone"))
        service_data = kwargs["service_data"]
        self.assertEqual(service_data["message"], "Has this been completed?")
        self.assertEqual(
            service_data["data"]["actions"],
            [{"action": "NC_CONFIRM_water_123", "title": "Done"}],
        )
        self.assertNotIn("optional", service_data["data"])

    def test_selected_notify_recipient_uses_generic_action(self):
        hass = self.Hass()
        dispatcher = notifications.NotificationDispatcher(hass)
        alert = {
            "id": "derived-service",
            "name": "Derived service",
            "notification": {
                "action": "notify.send_message",
                "target": {
                    "entity_id": [
                        "notify.mobile_app_phone"
                    ]
                },
                "message": "Check this",
                "confirmation": {
                    "enabled": True,
                    "button": "Done",
                },
            },
        }

        asyncio.run(
            dispatcher.async_send(
                alert,
                attempt=1,
                confirmation_action_id="NC_CONFIRM_derived",
                context=None,
                test=True,
            )
        )

        domain, service, kwargs = hass.services.calls[0]
        self.assertEqual(
            (domain, service),
            ("notify", "send_message"),
        )
        self.assertEqual(
            kwargs["target"],
            {"entity_id": ["notify.mobile_app_phone"]},
        )

    def test_selected_user_resolves_to_mobile_app_notify_entity(self):
        hass = self.Hass(
            [self.mobile_app_entry("mobile-entry", "a-user-id")],
            [self.notify_entity("notify.mobile_app_phone", "mobile-entry")],
        )
        dispatcher = notifications.NotificationDispatcher(hass)
        alert = {
            "id": "user-recipient",
            "name": "User recipient",
            "notification": {
                "target": {"user_id": ["a-user-id"]},
                "message": "Check this",
            },
        }

        asyncio.run(
            dispatcher.async_send(
                alert,
                attempt=1,
                confirmation_action_id=None,
                context=None,
                test=True,
            )
        )

        domain, service, kwargs = hass.services.calls[0]
        self.assertEqual((domain, service), ("notify", "send_message"))
        self.assertEqual(
            kwargs["target"],
            {"entity_id": ["notify.mobile_app_phone"]},
        )
        self.assertNotIn("user_id", kwargs["target"])

    def test_selected_user_combines_with_other_generic_recipients(self):
        hass = self.Hass(
            [self.mobile_app_entry("mobile-entry", "a-user-id")],
            [self.notify_entity("notify.mobile_app_phone", "mobile-entry")],
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        asyncio.run(
            dispatcher.async_send(
                {
                    "id": "mixed-recipients",
                    "name": "Mixed recipients",
                    "notification": {
                        "target": {
                            "user_id": ["a-user-id"],
                            "device_id": ["another-device"],
                        },
                        "message": "Check this",
                    },
                },
                attempt=1,
                confirmation_action_id=None,
                context=None,
                test=True,
            )
        )

        self.assertEqual(
            hass.services.calls[0][2]["target"],
            {
                "device_id": ["another-device"],
                "entity_id": ["notify.mobile_app_phone"],
            },
        )

    def test_selected_user_without_mobile_app_notify_entity_is_rejected(self):
        hass = self.Hass(
            [self.mobile_app_entry("mobile-entry", "a-user-id")],
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        with self.assertRaisesRegex(
            ValueError,
            "notification-capable mobile_app device: a-user-id",
        ):
            asyncio.run(
                dispatcher.async_send(
                    {
                        "id": "user-without-device",
                        "name": "User without device",
                        "notification": {
                            "target": {"user_id": ["a-user-id"]},
                            "message": "Check this",
                        },
                    },
                    attempt=1,
                    confirmation_action_id=None,
                    context=None,
                    test=True,
                )
            )

    def test_plain_test_payload_has_no_null_data_option(self):
        hass = self.Hass()
        dispatcher = notifications.NotificationDispatcher(hass)
        alert = {
            "id": "plain",
            "name": "Plain reminder",
            "notification": {
                "action": "notify.mobile_app_phone",
                "target": {},
                "title": "Reminder",
                "message": "Check this",
                "data": None,
                "confirmation": {"enabled": False},
            },
        }

        asyncio.run(
            dispatcher.async_send(
                alert,
                attempt=1,
                confirmation_action_id=None,
                context=None,
                test=True,
            )
        )

        service_data = hass.services.calls[0][2]["service_data"]
        self.assertNotIn("data", service_data)

    def test_confirmation_requires_a_recipient(self):
        hass = self.Hass()
        dispatcher = notifications.NotificationDispatcher(hass)
        alert = {
            "id": "unsupported",
            "name": "Unsupported action",
            "notification": {
                "action": "notify.send_message",
                "message": "Check this",
                "confirmation": {
                    "enabled": True,
                    "button": "Done",
                },
            },
        }

        with self.assertRaisesRegex(
            ValueError,
            "at least one.*recipient",
        ):
            asyncio.run(
                dispatcher.async_send(
                    alert,
                    attempt=1,
                    confirmation_action_id="NC_CONFIRM_unsupported",
                    context=None,
                    test=True,
                )
            )

    def test_missing_notification_service_is_rejected(self):
        hass = self.Hass()
        dispatcher = notifications.NotificationDispatcher(hass)

        with self.assertRaisesRegex(
            ValueError,
            "No valid notify service was found",
        ):
            asyncio.run(
                dispatcher.async_send(
                    {
                        "id": "missing-service",
                        "name": "Missing service",
                        "notification": {
                            "message": "Check this",
                        },
                    },
                    attempt=1,
                    confirmation_action_id=None,
                    context=None,
                    test=True,
                )
            )

    def test_draft_test_normalizes_and_does_not_save_or_change_runtime(self):
        manager = notifications.NotificationCenter.__new__(
            notifications.NotificationCenter
        )
        sent = []

        class Dispatcher:
            async def async_send(self, alert, **kwargs):
                sent.append((alert, kwargs))

        manager.dispatcher = Dispatcher()

        asyncio.run(
            manager.async_test_alert_payload(
                {
                    "id": "draft",
                    "name": "Draft alert",
                    "conditions": [],
                    "monitor": {"on_change": True},
                    "notification": {
                        "target": {"entity_id": ["notify.phone"]},
                        "message": "Preview this",
                        "confirmation": {"enabled": True},
                    },
                }
            )
        )

        self.assertEqual(len(sent), 1)
        alert, kwargs = sent[0]
        self.assertEqual(alert["notification"]["target"], {"entity_id": ["notify.phone"]})
        self.assertIsNone(kwargs["confirmation_action_id"])
        self.assertTrue(kwargs["test"])

    def test_post_send_actions_run_after_each_successful_dispatch(self):
        manager = notifications.NotificationCenter.__new__(
            notifications.NotificationCenter
        )
        calls = []

        class Dispatcher:
            async def async_send(self, *_args, **_kwargs):
                calls.append("notification")

        class Services:
            async def async_call(self, domain, service, **_kwargs):
                calls.append(f"{domain}.{service}")

        manager.dispatcher = Dispatcher()
        manager.hass = type("Hass", (), {"services": Services()})()
        manager._ensure_runtime_state = lambda _alert: {
            "attempts": 0,
        }
        manager._record_event = lambda *_args, **_kwargs: asyncio.sleep(0)
        manager._save_state = lambda: None
        notifications.dt_util.utcnow = lambda: datetime(
            2026, 1, 1, tzinfo=timezone.utc
        )

        asyncio.run(
            manager._send_notification(
                {
                    "id": "post-send",
                    "name": "Post-send",
                    "notification": {
                        "actions_enabled": True,
                        "actions": [{"action": "light.turn_on"}],
                    },
                },
                context=None,
            )
        )

        self.assertEqual(calls, ["notification", "light.turn_on"])

    def test_save_alert_replaces_existing_alert_instead_of_merging(self):
        manager = notifications.NotificationCenter.__new__(
            notifications.NotificationCenter
        )
        manager.storage = self.Storage(
            {
                "version": 1,
                "alerts": [
                    {
                        "id": "demo",
                        "name": "Old name",
                        "description": "Remove this",
                        "conditions": [],
                        "monitor": {"on_change": True, "startup": True},
                        "notification": {
                            "action": "notify.old",
                            "target": {},
                            "title": "Old",
                            "message": "Old",
                        },
                    },
                    {
                        "id": "other",
                        "name": "Other",
                        "conditions": [],
                        "monitor": {"on_change": True, "startup": True},
                        "notification": {"action": "notify.other"},
                    },
                ],
            }
        )
        manager.async_reload = lambda: asyncio.sleep(0)
        notifications.dt_util.utcnow = lambda: datetime(
            2026, 1, 1, tzinfo=timezone.utc
        )

        saved = asyncio.run(
            manager.async_save_alert(
                {
                    "id": "demo",
                    "name": "New name",
                    "conditions": [],
                    "monitor": {"on_change": False, "startup": True},
                    "notification": {
                        "action": "notify.new",
                        "target": {"entity_id": ["notify.phone"]},
                        "title": "New",
                        "message": "New",
                    },
                }
            )
        )

        self.assertEqual(saved["name"], "New name")
        self.assertEqual(len(manager.storage.config["alerts"]), 2)
        replaced = manager.storage.config["alerts"][0]
        self.assertEqual(replaced["name"], "New name")
        self.assertEqual(replaced["description"], "")
        self.assertEqual(manager.storage.config["alerts"][1]["id"], "other")

if __name__ == "__main__":
    unittest.main()