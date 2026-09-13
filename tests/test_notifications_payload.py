"""Tests for safe notification service payload construction."""

from __future__ import annotations

import asyncio
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
        def __init__(self):
            self.services = NotificationPayloadTests.ServiceRecorder()

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

if __name__ == "__main__":
    unittest.main()