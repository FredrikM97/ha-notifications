"""Tests for the feature-owned confirmation configuration and workflow helpers."""

from __future__ import annotations

import asyncio
import importlib
import unittest
from datetime import datetime, timezone
from types import MappingProxyType, SimpleNamespace

from custom_components.ha_notifications.domain.confirmation import (
    PendingConfirmationState,
)
from custom_components.ha_notifications.domain.runtime import AlertRuntimeState
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
confirmation = importlib.import_module(
    f"{PACKAGE_NAME}.features.confirmations"
)
preview = importlib.import_module(
    f"{PACKAGE_NAME}.features.notification_preview"
)


def runtime_with_pending(alert, **pending):
    runtime = AlertRuntimeState.for_alert(alert)
    runtime.record_event(PendingConfirmationState(**pending))
    return runtime


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


class ConfirmationConfigTests(unittest.TestCase):
    def test_confirmation_defaults_are_owned_by_confirmation_feature(self):
        config = confirmation.ConfirmationConfig.model_validate({"enabled": True})

        self.assertTrue(config.enabled)
        self.assertTrue(config.reminders.enabled)
        self.assertFalse(config.notification.enabled)

    def test_confirmation_is_read_from_alert_level(self):
        alert = {
            "confirmation": {
                "enabled": True,
                "buttons": [{"id": "confirm", "label": "Done"}],
            }
        }

        config = confirmation.ConfirmationConfig.from_alert(alert)

        self.assertIsNotNone(config)
        self.assertEqual(config.buttons[0].label, "Done")


class ConfirmationFeatureTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.sessions = {}
        self.feature = confirmation.ConfirmationFeature(None)
        self.sessions = self.feature._sessions
        self.now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    async def test_prepare_action_requires_enabled_confirmation(self):
        alert = {"id": "alert_1", "confirmation": {"enabled": False}}
        runtime = AlertRuntimeState.for_alert(alert)

        self.feature.prepare_action(runtime)

        self.assertFalse(runtime.condition_active)
        self.assertFalse(runtime.confirmation.action_ids)

    async def test_apply_confirmation_owns_state_delivery_and_persistence(self):
        now = self.now
        alert = {
            "id": "alert_1",
            "name": "Alert",
            "notification": {"message": "Original"},
            "confirmation": {
                "enabled": True,
                "buttons": [{"id": "confirm", "label": "Done"}],
                "notification": {
                    "enabled": True,
                    "clear": True,
                    "message": "Confirmed by {{ confirmed_by }}",
                },
            },
        }
        state = {
            "alert_1": runtime_with_pending(
                alert, action_ids={"action": "confirm"}, attempts=1
            )
        }
        state["alert_1"].activate(now)
        events = []
        sent = []
        cleared = []
        follow_up = []

        class Alerts:
            def runtime(self, alert_or_id):
                if isinstance(alert_or_id, str):
                    alert_id = alert_or_id
                    alert = None
                else:
                    alert = alert_or_id
                    alert_id = str(alert["id"])
                runtime = state[alert_id]
                if alert is not None:
                    runtime.config = dict(alert)
                return runtime

            def publish_event(self, *_args):
                events.append(_args[1])

        class Notification:
            async def clear(self, alert):
                cleared.append(alert)

            async def send(self, request):
                sent.append(request)
                return SimpleNamespace(success=True, error=None)

        class FollowUp:
            @staticmethod
            def actions_for_confirmation(_alert):
                return []

            async def execute(self, request):
                follow_up.append(request)

        self.feature._runtime = state
        async def render_template(source, _variables=None):
            return source

        self.feature._render_template = render_template
        self.feature.lifecycle = SimpleNamespace(
            feature=lambda name: {
                "alerts": Alerts(),
                "notification": Notification(),
                "follow_up_actions": FollowUp(),
            }[name]
        )

        result = confirmation.ConfirmationResult(
            state["alert_1"],
            confirmation.ConfirmationContext(
                "Alice",
                confirmation.ConfirmationSelection("action", "confirm", "Done"),
            ),
            now,
        )
        await self.feature._apply_confirmation(result)

        runtime = state["alert_1"]
        self.assertEqual(runtime.confirmation.action_ids, {})
        self.assertTrue(runtime.acknowledged)
        self.assertTrue(runtime.condition_active)
        self.assertEqual(events[0].value, "confirmed")
        self.assertEqual(len(cleared), 1)
        self.assertEqual(len(sent), 1)
        self.assertEqual(len(follow_up), 1)

    async def test_prepare_action_is_idempotent_for_pending_action(self):
        alert = {"id": "alert_1", "confirmation": {"enabled": True}}
        runtime = AlertRuntimeState.for_alert(alert)

        self.feature.prepare_action(runtime)
        first_action_ids = dict(runtime.confirmation.action_ids)
        self.feature.prepare_action(runtime)

        self.assertEqual(runtime.confirmation.action_ids, first_action_ids)

    async def test_prepare_action_creates_one_pending_action_per_button(self):
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

        self.feature.prepare_action(runtime)

        self.assertEqual(
            set(runtime.confirmation.action_ids.values()),
            {"snooze", "escalate"},
        )

    async def test_prepare_action_preserves_pending_actions(self):
        runtime = runtime_with_pending(
            {"id": "alert_1"}, action_ids={"action": "confirm"}
        )
        self.feature.prepare_action(runtime)

        self.assertEqual(
            runtime.confirmation.action_ids, {"action": "confirm"}
        )

    async def test_clear_is_idempotent(self):
        self.feature.clear("missing")
        runtime = AlertRuntimeState(config={"id": "alert_1"})
        self.feature.track("action", runtime=runtime)
        self.feature.clear("action")

        self.assertNotIn("action", self.sessions)

    async def test_expire_stale_clears_persisted_actions_and_sessions(self):
        runtime = runtime_with_pending(
            {"id": "alert_1"}, action_ids={"action": "confirm"}
        )
        runtime.state["last_notified"] = "2023-12-20T00:00:00+00:00"
        self.feature.track("action", runtime=runtime)

        expired = self.feature.expire_stale(
            runtime, datetime(2024, 1, 1, tzinfo=timezone.utc)
        )

        self.assertTrue(expired)
        self.assertEqual(runtime.confirmation.action_ids, {})
        self.assertFalse(self.feature.has_pending("action"))

    async def test_expire_exhausted_clears_actions_at_max_attempts(self):
        alert = {
            "id": "alert_1",
            "confirmation": {
                "enabled": True,
                "reminders": {"enabled": True, "max_attempts": 2},
            },
        }
        runtime = runtime_with_pending(
            alert, action_ids={"action": "confirm"}, attempts=2
        )
        self.feature.track("action", runtime=runtime)

        expired = self.feature.expire_exhausted(runtime)

        self.assertEqual(expired.attempts, 2)
        self.assertEqual(expired.max_attempts, 2)
        self.assertEqual(runtime.confirmation.action_ids, {})
        self.assertFalse(self.feature.has_pending("action"))

    async def test_resolve_saved_action_event(self):
        class Hass:
            class States:
                @staticmethod
                def async_all(_domain):
                    return []

            class Auth:
                async def async_get_user(self, _user_id):
                    return None

            states = States()
            auth = Auth()

        self.feature._hass = Hass()

        alert = {"id": "alert_1", "name": "Saved"}
        self.feature._runtime = {
            "alert_1": runtime_with_pending(
                alert, action_ids={"saved_action": "confirm"}
            )
        }
        self.feature.track("saved_action", runtime=self.feature._runtime["alert_1"])
        result = await self.feature.resolve_action_event(
            SimpleNamespace(
                data={"action": "saved_action"},
                context=SimpleNamespace(user_id=None),
            )
        )
        self.assertEqual(result.runtime.config["name"], "Saved")

    async def test_mobile_done_action_dispatches_confirmation_workflow(self):
        class Hass:
            class States:
                @staticmethod
                def async_all(_domain):
                    return []

            class Auth:
                async def async_get_user(self, _user_id):
                    return None

            states = States()
            auth = Auth()

        class Coordinator:
            async def run(self, _alert_id, callback):
                await callback()

        self.feature._hass = Hass()
        runtime = runtime_with_pending(
            {"id": "alert_1", "name": "Saved"},
            action_ids={"saved_action": "confirm"},
        )
        self.feature.track("saved_action", runtime=runtime)
        dispatched = []

        async def apply_confirmation(result):
            dispatched.append(result)

        self.feature._apply_confirmation = apply_confirmation
        self.feature.lifecycle = SimpleNamespace(
            feature=lambda _name: Coordinator()
        )

        await self.feature._on_action_event(
            SimpleNamespace(
                data=MappingProxyType({"action": "saved_action"}),
                context=SimpleNamespace(user_id=None),
            )
        )

        self.assertEqual(len(dispatched), 1)
        self.assertEqual(dispatched[0].confirmation.selection.label, "Done")
        self.assertEqual(dispatched[0].runtime.config["name"], "Saved")

    async def test_resolving_one_response_clears_sibling_responses(self):
        class Hass:
            class States:
                @staticmethod
                def async_all(_domain):
                    return []

            class Auth:
                async def async_get_user(self, _user_id):
                    return None

            states = States()
            auth = Auth()

        self.feature._hass = Hass()
        alert = {"id": "alert_1", "name": "Saved"}
        self.feature._runtime = {
            "alert_1": runtime_with_pending(
                alert,
                action_ids={
                    "snooze": "snooze",
                    "escalate": "escalate",
                },
            )
        }
        self.feature.track(
            "snooze",
            runtime=self.feature._runtime["alert_1"],
            selection=confirmation.ConfirmationSelection(
                "snooze", "snooze", "Snooze"
            ),
        )
        self.feature.track(
            "escalate",
            runtime=self.feature._runtime["alert_1"],
            selection=confirmation.ConfirmationSelection(
                "escalate", "escalate", "Escalate"
            ),
        )

        result = await self.feature.resolve_action_event(
            SimpleNamespace(
                data={"action": "snooze"},
                context=SimpleNamespace(user_id=None),
            )
        )

        self.assertEqual(result.confirmation.selection.response_id, "snooze")
        self.assertFalse(self.feature.has_pending("snooze"))
        self.assertFalse(self.feature.has_pending("escalate"))


class PersonResolutionTests(unittest.TestCase):
    def test_resolves_matching_person(self):
        state = SimpleNamespace(attributes={"user_id": "u1"}, name="Alice")

        self.assertEqual(confirmation.resolve_person_name([state], "u1"), "Alice")

    def test_auth_user_fallback_resolves_without_person_entity(self):
        class FakeAuth:
            async def async_get_user(self, _user_id):
                return SimpleNamespace(name="Carol")

        result = asyncio.run(
            confirmation.resolve_confirmed_by(
                SimpleNamespace(auth=FakeAuth()), [], "u3"
            )
        )

        self.assertEqual(result, "Carol")

    def test_person_resolution_handles_missing_and_unknown_users(self):
        self.assertEqual(confirmation.resolve_person_name([], None), "Unknown user")
        self.assertEqual(
            confirmation.resolve_person_name(
                [SimpleNamespace(attributes={"user_id": "other"}, name="Bob")],
                "u1",
            ),
            "Unknown user",
        )

    def test_blank_person_name_falls_back_to_unknown_user(self):
        self.assertEqual(
            confirmation.resolve_person_name(
                [SimpleNamespace(attributes={"user_id": "u1"}, name="")],
                "u1",
            ),
            "Unknown user",
        )

    def test_extract_action_id_accepts_only_nonempty_mapping_actions(self):
        self.assertIsNone(confirmation.extract_action_id(None))
        self.assertIsNone(confirmation.extract_action_id({}))
        self.assertEqual(
            confirmation.extract_action_id({"action": "confirm_1"}), "confirm_1"
        )
        self.assertEqual(
            confirmation.extract_action_id(
                MappingProxyType({"action": "confirm_1"})
            ),
            "confirm_1",
        )


if __name__ == "__main__":
    unittest.main()
