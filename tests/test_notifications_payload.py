"""Tests for safe notification service payload construction."""

from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from test_support import load_notifications

notifications = load_notifications()


class NotificationPayloadTests(unittest.TestCase):
    class ServiceRecorder:
        def __init__(self, notify_services=()):
            self.calls = []
            self.notify_services = set(notify_services)

        def has_service(self, domain, service):
            return domain == "notify" and service in self.notify_services

        async def async_call(self, domain, service, **kwargs):
            self.calls.append((domain, service, kwargs))

    class Hass:
        def __init__(
            self,
            mobile_app_entries=(),
            entities=(),
            people=(),
            devices=(),
            areas=(),
            notify_services=(),
        ):
            self.services = NotificationPayloadTests.ServiceRecorder(notify_services)
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
            self.device_registry = type(
                "DeviceRegistry",
                (),
                {"devices": {device.id: device for device in devices}},
            )()
            self.area_registry = type(
                "AreaRegistry",
                (),
                {"areas": {area.area_id: area for area in areas}},
            )()
            self.states = type(
                "States",
                (),
                {
                    "async_all": lambda _self, domain: (
                        people if domain == "person" else []
                    )
                },
            )()

    @staticmethod
    def mobile_app_entry(entry_id, user_id, webhook_id=None, title=None):
        data = {"user_id": user_id}
        if webhook_id:
            data["webhook_id"] = webhook_id
        return type(
            "ConfigEntry",
            (),
            {"entry_id": entry_id, "data": data, "title": title or entry_id},
        )()

    @staticmethod
    def notify_entity(
        entity_id,
        config_entry_id=None,
        device_id=None,
        area_id=None,
        labels=(),
    ):
        return type(
            "EntityEntry",
            (),
            {
                "entity_id": entity_id,
                "config_entry_id": config_entry_id,
                "device_id": device_id,
                "area_id": area_id,
                "labels": set(labels),
            },
        )()

    @staticmethod
    def person(user_id, device_trackers):
        return type(
            "PersonState",
            (),
            {"attributes": {"user_id": user_id, "device_trackers": device_trackers}},
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
        hass = self.Hass(notify_services=("mobile_app_phone",))
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

    def test_legacy_persistent_setting_is_ignored(self):
        hass = self.Hass(notify_services=("mobile_app_phone",))
        dispatcher = notifications.NotificationDispatcher(hass)
        alert = {
            "id": "water",
            "name": "Water reminder",
            "notification": {
                "action": "notify.mobile_app_phone",
                "target": {},
                "title": "Reminder",
                "message": "Has this been completed?",
                "persistent": True,
            },
        }

        asyncio.run(
            dispatcher.async_send(
                alert,
                attempt=1,
                confirmation_action_id=None,
                context=None,
            )
        )

        self.assertEqual(
            [(domain, service) for domain, service, _kwargs in hass.services.calls],
            [("notify", "mobile_app_phone")],
        )

    def test_legacy_persistent_setting_does_not_replace_a_recipient(self):
        hass = self.Hass()
        dispatcher = notifications.NotificationDispatcher(hass)
        alert = {
            "id": "water",
            "name": "Water reminder",
            "notification": {
                "persistent": True,
            },
        }

        with self.assertRaisesRegex(ValueError, "No valid notify service"):
            asyncio.run(
                dispatcher.async_send(
                    alert,
                    attempt=1,
                    confirmation_action_id=None,
                    context=None,
                )
            )

    def test_clear_ignores_legacy_persistent_setting(self):
        hass = self.Hass()
        dispatcher = notifications.NotificationDispatcher(hass)

        asyncio.run(
            dispatcher.async_clear(
                {
                    "id": "water",
                    "name": "Water reminder",
                    "notification": {"persistent": True},
                },
                context=None,
            )
        )

        self.assertEqual(hass.services.calls, [])

    def test_confirmation_can_preserve_existing_notifications(self):
        manager = notifications.NotificationCenter.__new__(
            notifications.NotificationCenter
        )
        clear_calls = []

        class Dispatcher:
            async def async_clear(self, alert, **kwargs):
                clear_calls.append((alert, kwargs))

        class Storage:
            def async_delay_save_state(self, state):
                pass

        alert = {
            "id": "water",
            "name": "Water reminder",
            "notification": {
                "confirmation": {
                    "enabled": True,
                    "clear_on_confirmation": False,
                }
            },
        }
        manager.alerts = {"water": alert}
        manager.state = {
            "alerts": {
                "water": {
                    "confirmation_action_id": "NC_CONFIRM_water",
                }
            },
            "history": [],
        }
        manager._pending_actions = {"NC_CONFIRM_water": "water"}
        manager.dispatcher = Dispatcher()
        manager.history = type(
            "History",
            (),
            {"record": lambda *_args, **_kwargs: asyncio.sleep(0)},
        )()
        manager.storage = Storage()
        notifications.dt_util.utcnow = lambda: datetime(
            2026, 9, 13, tzinfo=timezone.utc
        )

        asyncio.run(
            manager._handle_notification_action(
                SimpleNamespace(
                    data={"action": "NC_CONFIRM_water"},
                    context=SimpleNamespace(user_id=None),
                )
            )
        )

        self.assertEqual(clear_calls, [])
        self.assertTrue(manager.state["alerts"]["water"]["acknowledged"])

    def test_confirmation_sends_completion_notification_without_new_action(self):
        manager = notifications.NotificationCenter.__new__(
            notifications.NotificationCenter
        )
        sent = []
        events = []

        class Dispatcher:
            async def async_clear(self, *_args, **_kwargs):
                pass

            async def async_send(self, alert, **kwargs):
                sent.append((alert, kwargs))

        class Storage:
            def async_delay_save_state(self, state):
                pass

        class History:
            async def record(self, _alert, event_type, *_args, **_kwargs):
                events.append(event_type)

        alert = {
            "id": "water",
            "name": "Water reminder",
            "notification": {
                "message": "Check this",
                "confirmation": {
                    "enabled": True,
                    "completion_message": "Completed",
                },
            },
        }
        manager.hass = self.Hass()
        manager.alerts = {"water": alert}
        manager.state = {
            "alerts": {
                "water": {
                    "confirmation_action_id": "NC_CONFIRM_water",
                }
            },
            "history": [],
        }
        manager._pending_actions = {"NC_CONFIRM_water": "water"}
        manager.dispatcher = Dispatcher()
        manager.history = History()
        manager.storage = Storage()
        notifications.dt_util.utcnow = lambda: datetime(
            2026, 9, 13, tzinfo=timezone.utc
        )

        asyncio.run(
            manager._handle_notification_action(
                SimpleNamespace(
                    data={"action": "NC_CONFIRM_water"},
                    context=SimpleNamespace(user_id=None),
                )
            )
        )

        self.assertEqual(len(sent), 1)
        completion_alert, kwargs = sent[0]
        self.assertEqual(completion_alert["notification"]["message"], "Completed")
        self.assertEqual(
            completion_alert["notification"]["confirmation"],
            {"enabled": False},
        )
        self.assertIsNone(kwargs["confirmation_action_id"])
        self.assertIn("completion_sent", events)

    def test_confirmation_uses_direct_mobile_app_service_for_selected_device(self):
        hass = self.Hass(
            [
                self.mobile_app_entry(
                    "mobile-entry",
                    "a-user-id",
                    "phone-webhook",
                )
            ],
            [
                self.notify_entity(
                    "notify.fredrik_mobil",
                    "mobile-entry",
                    "phone-device",
                )
            ],
            devices=[
                SimpleNamespace(
                    id="phone-device",
                    area_id=None,
                    labels=set(),
                    config_entries={"mobile-entry"},
                    name="Fredrik Mobil",
                    name_by_user=None,
                )
            ],
            notify_services=("mobile_app_fredrik_mobil",),
        )
        dispatcher = notifications.NotificationDispatcher(hass)
        alert = {
            "id": "derived-service",
            "name": "Derived service",
            "notification": {
                "action": "notify.send_message",
                "target": {
                    "device_id": ["phone-device"]
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
        self.assertEqual((domain, service), ("notify", "mobile_app_fredrik_mobil"))
        self.assertIsNone(kwargs["target"])
        self.assertEqual(
            kwargs["service_data"]["data"]["actions"],
            [{"action": "NC_CONFIRM_derived", "title": "Done"}],
        )

    def test_confirmation_resolves_mobile_app_entity_through_device_entry(self):
        hass = self.Hass(
            [
                self.mobile_app_entry(
                    "mobile-entry",
                    "a-user-id",
                    "phone-webhook",
                )
            ],
            [self.notify_entity("notify.fredrik_mobil", "mobile-entry")],
            devices=[
                SimpleNamespace(
                    id="phone-device",
                    area_id=None,
                    labels=set(),
                    config_entries={"mobile-entry"},
                    name="Fredrik Mobil",
                    name_by_user=None,
                )
            ],
            notify_services=("mobile_app_fredrik_mobil",),
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        asyncio.run(
            dispatcher.async_send(
                {
                    "id": "device-confirmation",
                    "name": "Device confirmation",
                    "notification": {
                        "target": {"device_id": ["phone-device"]},
                        "message": "Check this",
                        "confirmation": {"enabled": True, "button": "Done"},
                    },
                },
                attempt=1,
                confirmation_action_id="NC_CONFIRM_device",
                context=None,
                test=True,
            )
        )

        domain, service, kwargs = hass.services.calls[0]
        self.assertEqual((domain, service), ("notify", "mobile_app_fredrik_mobil"))
        self.assertIsNone(kwargs["target"])

    def test_confirmation_uses_verified_legacy_service_for_selected_label_device(self):
        hass = self.Hass(
            [self.mobile_app_entry("mobile-entry", "a-user-id")],
            devices=[
                SimpleNamespace(
                    id="phone-device",
                    area_id=None,
                    labels={"family"},
                    config_entries={"mobile-entry"},
                    name="Fredrik Mobil",
                    name_by_user=None,
                )
            ],
            notify_services=("mobile_app_fredrik_mobil",),
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        asyncio.run(
            dispatcher.async_send(
                {
                    "id": "legacy-label-confirmation",
                    "name": "Legacy label confirmation",
                    "notification": {
                        "target": {"label_id": ["family"]},
                        "message": "Check this",
                        "confirmation": {"enabled": True, "button": "Done"},
                    },
                },
                attempt=1,
                confirmation_action_id="NC_CONFIRM_legacy_label",
                context=None,
                test=True,
            )
        )

        domain, service, kwargs = hass.services.calls[0]
        self.assertEqual((domain, service), ("notify", "mobile_app_fredrik_mobil"))
        self.assertIsNone(kwargs["target"])
        self.assertEqual(
            kwargs["service_data"]["data"]["actions"],
            [{"action": "NC_CONFIRM_legacy_label", "title": "Done"}],
        )

    def test_confirmation_uses_verified_legacy_service_when_webhook_exists(self):
        hass = self.Hass(
            [self.mobile_app_entry("mobile-entry", "a-user-id", "phone-webhook")],
            [
                self.notify_entity(
                    "notify.fredrik_mobil",
                    "mobile-entry",
                    "phone-device",
                )
            ],
            devices=[
                SimpleNamespace(
                    id="phone-device",
                    area_id=None,
                    labels=set(),
                    config_entries={"mobile-entry"},
                    name="Fredrik Mobil",
                    name_by_user=None,
                )
            ],
            notify_services=("mobile_app_fredrik_mobil",),
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        asyncio.run(
            dispatcher.async_send(
                {
                    "id": "webhook-priority",
                    "name": "Webhook priority",
                    "notification": {
                        "target": {"device_id": ["phone-device"]},
                        "message": "Check this",
                        "confirmation": {"enabled": True},
                    },
                },
                attempt=1,
                confirmation_action_id="NC_CONFIRM_webhook_priority",
                context=None,
                test=True,
            )
        )

        domain, service, kwargs = hass.services.calls[0]
        self.assertEqual((domain, service), ("notify", "mobile_app_fredrik_mobil"))
        self.assertIsNone(kwargs["target"])

    def test_confirmation_rejects_mobile_device_without_webhook_or_legacy_service(self):
        hass = self.Hass(
            [self.mobile_app_entry("mobile-entry", "a-user-id")],
            devices=[
                SimpleNamespace(
                    id="phone-device",
                    area_id=None,
                    labels=set(),
                    config_entries={"mobile-entry"},
                    name="Fredrik Mobil",
                    name_by_user=None,
                )
            ],
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        with self.assertRaisesRegex(ValueError, "resolved Mobile App direct service"):
            asyncio.run(
                dispatcher.async_send(
                    {
                        "id": "unavailable-mobile-device",
                        "name": "Unavailable mobile device",
                        "notification": {
                            "target": {"device_id": ["phone-device"]},
                            "confirmation": {"enabled": True},
                        },
                    },
                    attempt=1,
                    confirmation_action_id="NC_CONFIRM_unavailable_mobile",
                    context=None,
                    test=True,
                )
            )

    def test_clear_uses_direct_mobile_app_service_for_selected_device(self):
        hass = self.Hass(
            [self.mobile_app_entry("mobile-entry", "a-user-id", "phone-webhook")],
            [self.notify_entity("notify.fredrik_mobil", "mobile-entry")],
            devices=[
                SimpleNamespace(
                    id="phone-device",
                    area_id=None,
                    labels=set(),
                    config_entries={"mobile-entry"},
                    name="Fredrik Mobil",
                    name_by_user=None,
                )
            ],
            notify_services=("mobile_app_fredrik_mobil",),
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        asyncio.run(
            dispatcher.async_clear(
                {
                    "id": "device-confirmation",
                    "name": "Device confirmation",
                    "notification": {
                        "action": "notify.send_message",
                        "target": {"device_id": ["phone-device"]},
                    },
                },
                context=None,
            )
        )

        domain, service, kwargs = hass.services.calls[0]
        self.assertEqual((domain, service), ("notify", "mobile_app_fredrik_mobil"))
        self.assertIsNone(kwargs["target"])

    def test_mobile_app_selector_without_confirmation_uses_direct_legacy_service(self):
        hass = self.Hass(
            [
                self.mobile_app_entry(
                    "mobile-entry",
                    "a-user-id",
                    "phone-webhook",
                )
            ],
            [
                self.notify_entity(
                    "notify.fredrik_mobil",
                    "mobile-entry",
                    "phone-device",
                )
            ],
            devices=[
                SimpleNamespace(
                    id="phone-device",
                    area_id=None,
                    labels=set(),
                    config_entries={"mobile-entry"},
                    name="Fredrik Mobil",
                    name_by_user=None,
                )
            ],
            notify_services=("mobile_app_fredrik_mobil",),
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        asyncio.run(
            dispatcher.async_send(
                {
                    "id": "generic-recipient",
                    "name": "Generic recipient",
                    "notification": {
                        "action": "notify.send_message",
                        "target": {"device_id": ["phone-device"]},
                    },
                },
                attempt=1,
                confirmation_action_id=None,
                context=None,
                test=True,
            )
        )

        domain, service, kwargs = hass.services.calls[0]
        self.assertEqual((domain, service), ("notify", "mobile_app_fredrik_mobil"))
        self.assertIsNone(kwargs["target"])

    def test_non_mobile_notify_recipient_without_confirmation_uses_generic_action(self):
        hass = self.Hass(
            entities=[self.notify_entity("notify.email_recipient")]
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        asyncio.run(
            dispatcher.async_send(
                {
                    "id": "non-mobile-recipient",
                    "name": "Non-mobile recipient",
                    "notification": {
                        "action": "notify.send_message",
                        "target": {"entity_id": ["notify.email_recipient"]},
                    },
                },
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
            {"entity_id": ["notify.email_recipient"]},
        )

    def test_mixed_notify_recipients_without_confirmation_use_generic_action(self):
        hass = self.Hass(
            [
                self.mobile_app_entry(
                    "mobile-entry",
                    "a-user-id",
                    "phone-webhook",
                )
            ],
            [
                self.notify_entity("notify.fredrik_mobil", "mobile-entry"),
                self.notify_entity("notify.email_recipient"),
            ],
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        asyncio.run(
            dispatcher.async_send(
                {
                    "id": "mixed-recipients",
                    "name": "Mixed recipients",
                    "notification": {
                        "action": "notify.send_message",
                        "target": {
                            "entity_id": [
                                "notify.fredrik_mobil",
                                "notify.email_recipient",
                            ]
                        },
                    },
                },
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
            {
                "entity_id": [
                    "notify.fredrik_mobil",
                    "notify.email_recipient",
                ]
            },
        )

    def test_confirmation_target_without_notifier_is_rejected(self):
        hass = self.Hass()
        dispatcher = notifications.NotificationDispatcher(hass)

        with self.assertRaisesRegex(ValueError, "resolved Mobile App direct service"):
            asyncio.run(
                dispatcher.async_send(
                    {
                        "id": "unavailable-recipient",
                        "name": "Unavailable recipient",
                        "notification": {
                            "action": "notify.send_message",
                            "target": {"device_id": ["phone"]},
                            "confirmation": {"enabled": True},
                        },
                    },
                    attempt=1,
                    confirmation_action_id="NC_CONFIRM_unavailable",
                    context=None,
                    test=True,
                )
            )

    def test_confirmation_resolves_all_selector_target_types(self):
        device = SimpleNamespace(
            id="phone-device",
            area_id="kitchen",
            labels={"family"},
            config_entries={"mobile-entry"},
            name="Phone",
            name_by_user=None,
        )
        area = SimpleNamespace(area_id="kitchen", floor_id="ground-floor")
        entities = [
            self.notify_entity(
                "notify.mobile_app_phone",
                "mobile-entry",
                "phone-device",
                labels=("family",),
            ),
            self.notify_entity("device_tracker.phone", device_id="phone-device"),
        ]
        targets = [
            {"entity_id": ["notify.mobile_app_phone"]},
            {"device_id": ["phone-device"]},
            {"area_id": ["kitchen"]},
            {"floor_id": ["ground-floor"]},
            {"label_id": ["family"]},
            {"user_id": ["a-user-id"]},
        ]

        for target in targets:
            hass = self.Hass(
                [
                    self.mobile_app_entry(
                        "mobile-entry",
                        "a-user-id",
                        "phone-webhook",
                    )
                ],
                entities,
                [self.person("a-user-id", ["device_tracker.phone"])],
                [device],
                [area],
                notify_services=("mobile_app_phone",),
            )
            dispatcher = notifications.NotificationDispatcher(hass)

            asyncio.run(
                dispatcher.async_send(
                    {
                        "id": "selector-recipient",
                        "name": "Selector recipient",
                        "notification": {
                            "action": "notify.send_message",
                            "target": target,
                            "confirmation": {"enabled": True},
                        },
                    },
                    attempt=1,
                    confirmation_action_id="NC_CONFIRM_selector",
                    context=None,
                    test=True,
                )
            )

            domain, service, kwargs = hass.services.calls[0]
            self.assertEqual((domain, service), ("notify", "mobile_app_phone"))
            self.assertIsNone(kwargs["target"])

    def test_confirmation_rejects_selected_non_mobile_notify_entity(self):
        hass = self.Hass(
            entities=[self.notify_entity("notify.email_recipient")]
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        with self.assertRaisesRegex(ValueError, "resolved Mobile App direct service"):
            asyncio.run(
                dispatcher.async_send(
                    {
                        "id": "non-mobile-recipient",
                        "name": "Non-mobile recipient",
                        "notification": {
                            "action": "notify.send_message",
                            "target": {
                                "entity_id": ["notify.email_recipient"]
                            },
                            "confirmation": {"enabled": True},
                        },
                    },
                    attempt=1,
                    confirmation_action_id="NC_CONFIRM_non_mobile",
                    context=None,
                    test=True,
                )
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

    def test_selected_user_resolves_notify_entity_on_person_device(self):
        tracker = self.notify_entity("device_tracker.alex_phone", device_id="phone")
        notifier = self.notify_entity("notify.phone", device_id="phone")
        hass = self.Hass(
            entities=[tracker, notifier],
            people=[self.person("a-user-id", ["device_tracker.alex_phone"])],
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        asyncio.run(
            dispatcher.async_send(
                {
                    "id": "person-device-recipient",
                    "name": "Person device recipient",
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

        self.assertEqual(
            hass.services.calls[0][2]["target"],
            {"entity_id": ["notify.phone"]},
        )

    def test_selected_user_without_mobile_app_notify_entity_is_rejected(self):
        hass = self.Hass(
            [self.mobile_app_entry("mobile-entry", "a-user-id")],
        )
        dispatcher = notifications.NotificationDispatcher(hass)

        with self.assertRaisesRegex(
            ValueError,
            "notification-capable device: a-user-id",
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
        hass = self.Hass(notify_services=("mobile_app_phone",))
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

        with self.assertRaisesRegex(ValueError, "resolved Mobile App direct service"):
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

    def test_draft_test_has_isolated_confirmation_and_no_runtime_state(self):
        manager = notifications.NotificationCenter.__new__(
            notifications.NotificationCenter
        )
        sent = []

        class Dispatcher:
            async def async_send(self, alert, **kwargs):
                sent.append((alert, kwargs))

        manager.dispatcher = Dispatcher()

        result = asyncio.run(
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
        self.assertEqual(
            alert["notification"]["target"],
            {"entity_id": ["notify.phone"]},
        )
        self.assertNotEqual(alert["id"], "draft")
        self.assertEqual(result["session_id"], alert["id"])
        self.assertEqual(
            kwargs["confirmation_action_id"],
            result["confirmation_action_id"],
        )
        self.assertIn(
            result["confirmation_action_id"],
            manager.draft_sessions.actions,
        )
        self.assertFalse(hasattr(manager, "state"))
        self.assertTrue(kwargs["test"])

    def test_draft_confirmation_consumes_action_without_live_runtime_changes(self):
        manager = notifications.NotificationCenter.__new__(
            notifications.NotificationCenter
        )
        clears = []

        class Dispatcher:
            async def async_send(self, *_args, **_kwargs):
                pass

            async def async_clear(self, alert, **kwargs):
                clears.append((alert, kwargs))

        manager.dispatcher = Dispatcher()
        manager._resolve_user = lambda _user_id: "Alex"
        result = asyncio.run(
            manager.async_test_alert_payload(
                {
                    "id": "draft",
                    "name": "Draft alert",
                    "conditions": [],
                    "monitor": {"on_change": True},
                    "notification": {
                        "target": {"entity_id": ["notify.phone"]},
                        "confirmation": {
                            "enabled": True,
                            "clear_on_confirmation": True,
                        },
                    },
                }
            )
        )

        asyncio.run(
            manager._handle_notification_action(
                SimpleNamespace(
                    data={"action": result["confirmation_action_id"]},
                    context=SimpleNamespace(user_id=None),
                )
            )
        )

        self.assertEqual(len(clears), 1)
        self.assertEqual(manager.draft_sessions.actions, {})
        self.assertEqual(manager.draft_sessions.sessions, {})
        self.assertFalse(hasattr(manager, "state"))

    def test_draft_sessions_can_be_disposed_and_expire(self):
        manager = notifications.NotificationCenter.__new__(
            notifications.NotificationCenter
        )

        class Dispatcher:
            async def async_send(self, *_args, **_kwargs):
                pass

        manager.dispatcher = Dispatcher()
        result = asyncio.run(
            manager.async_test_alert_payload(
                {
                    "id": "draft",
                    "name": "Draft alert",
                    "conditions": [],
                    "monitor": {"on_change": True},
                    "notification": {
                        "target": {"entity_id": ["notify.phone"]},
                        "confirmation": {"enabled": True},
                    },
                }
            )
        )
        session_id = result["session_id"]
        asyncio.run(manager.async_discard_draft_test(session_id))

        self.assertNotIn(session_id, manager.draft_sessions.sessions)
        self.assertNotIn(
            result["confirmation_action_id"],
            manager.draft_sessions.actions,
        )

        result = asyncio.run(
            manager.async_test_alert_payload(
                {
                    "id": "draft",
                    "name": "Draft alert",
                    "conditions": [],
                    "monitor": {"on_change": True},
                    "notification": {
                        "target": {"entity_id": ["notify.phone"]},
                        "confirmation": {"enabled": True},
                    },
                }
            )
        )
        session_id = result["session_id"]
        manager.draft_sessions.sessions[session_id] = datetime(
            2000, 1, 1, tzinfo=timezone.utc
        )

        asyncio.run(manager.async_discard_draft_test("another-session"))

        self.assertNotIn(session_id, manager.draft_sessions.sessions)
        self.assertNotIn(
            result["confirmation_action_id"],
            manager.draft_sessions.actions,
        )

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
        manager.history = type(
            "History",
            (),
            {"record": lambda *_args, **_kwargs: asyncio.sleep(0)},
        )()
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