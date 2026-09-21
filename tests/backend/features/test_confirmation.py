"""Tests for the feature-owned confirmation configuration and workflow helpers."""

from __future__ import annotations

import asyncio
import importlib
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
confirmation = importlib.import_module(f"{PACKAGE_NAME}.features.confirmation")
testing = importlib.import_module(f"{PACKAGE_NAME}.features.testing")


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
    def test_confirmation_context_projects_to_templates_and_history(self):
        context = confirmation.ConfirmationContext(
            "Alice",
            confirmation.ConfirmationSelection("action", "snooze", "Snooze"),
        )

        self.assertEqual(
            context.template_values(),
            {
                "confirmed_by": "Alice",
                "confirmation_response_id": "snooze",
                "confirmation_response": "Snooze",
            },
        )
        self.assertEqual(
            context.history_details(),
            {
                "confirmed_by": "Alice",
                "response_id": "snooze",
                "response": "Snooze",
            },
        )

    def test_confirmation_defaults_are_owned_by_confirmation_feature(self):
        config = confirmation.ConfirmationConfig.model_validate({"enabled": True})

        self.assertTrue(config.enabled)
        self.assertTrue(config.reminders.enabled)
        self.assertFalse(config.notification.enabled)
        self.assertFalse(config.actions.enabled)

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
        self.feature = confirmation.ConfirmationFeature(
            None,
            {},
            None,
            None,
        )
        self.sessions = self.feature._sessions
        self.now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    async def test_prepare_action_requires_enabled_confirmation(self):
        runtime = {}

        await self.feature.prepare_action(
            {"id": "alert_1", "confirmation": {"enabled": False}}, runtime
        )

        self.assertEqual(runtime, {})

    async def test_prepare_action_is_idempotent_for_pending_action(self):
        runtime = {}
        alert = {"id": "alert_1", "confirmation": {"enabled": True}}

        await self.feature.prepare_action(alert, runtime)
        first_action_ids = dict(runtime["confirmation_action_ids"])
        await self.feature.prepare_action(alert, runtime)

        self.assertEqual(runtime["confirmation_action_ids"], first_action_ids)

    async def test_prepare_action_creates_one_pending_action_per_button(self):
        runtime = {}
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

        await self.feature.prepare_action(alert, runtime)

        self.assertEqual(
            set(runtime["confirmation_action_ids"].values()),
            {"snooze", "escalate"},
        )

    async def test_prepare_action_preserves_pending_actions(self):
        runtime = {"confirmation_action_ids": {"action": "confirm"}}

        await self.feature.prepare_action(
            {"id": "alert_1", "confirmation": {"enabled": True}}, runtime
        )

        self.assertEqual(runtime["confirmation_action_ids"], {"action": "confirm"})

    async def test_draft_session_expires_and_can_be_cleared(self):
        await self.feature.track(
            "draft",
            now=self.now,
            draft_alert={"id": "draft"},
            ttl=confirmation.DRAFT_SESSION_TTL,
        )
        self.assertIn("draft", self.sessions)

        expired = await self.feature.expire_drafts(
            self.now + confirmation.DRAFT_SESSION_TTL
        )

        self.assertEqual(expired, ["draft"])
        self.assertNotIn("draft", self.sessions)

    async def test_clear_is_idempotent(self):
        await self.feature.clear("missing")
        await self.feature.track("action", now=self.now, alert_id="alert_1")
        await self.feature.clear("action")

        self.assertNotIn("action", self.sessions)

    async def test_test_confirmation_is_not_bound_to_saved_runtime(self):
        alert = {"id": "alert_1", "confirmation": {"enabled": True}}

        class Lifecycle:
            feature_instance = self.feature

            def feature(self, name):
                if name != "confirmation":
                    raise AssertionError(name)
                return self.feature_instance

        test_feature = testing.TestFeature(None, {}, None, None)
        test_feature.lifecycle = Lifecycle()
        action_ids = await test_feature._prepare_test_action(alert)
        action_id = next(iter(action_ids), None)

        self.assertIsNotNone(action_id)
        session = self.sessions[action_id]

        self.assertIsNone(session.alert_id)
        self.assertEqual(session.draft_alert, alert)

    async def test_resolve_draft_and_saved_action_events(self):
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
        draft = {"id": "draft_1", "name": "Draft"}
        await self.feature.track(
            "draft_action",
            now=self.now,
            draft_alert=draft,
            selection=confirmation.ConfirmationSelection(
                "draft_action", "snooze", "Snooze"
            ),
        )
        result = await self.feature.resolve_action_event(
            SimpleNamespace(
                data={"action": "draft_action"},
                context=SimpleNamespace(user_id=None),
            )
        )
        self.assertEqual(result.alert, draft)
        self.assertTrue(result.test)
        self.assertEqual(result.confirmation.selection.response_id, "snooze")
        self.assertEqual(result.confirmation.selection.label, "Snooze")
        self.assertFalse(self.feature.has_pending("draft_action"))

        alert = SimpleNamespace(
            model_dump=lambda exclude_none=True: {"id": "alert_1", "name": "Saved"}
        )
        self.feature._alerts = {"alert_1": alert}
        self.feature._state["runtime"] = {
            "alert_1": {
                "confirmation_action_ids": {"saved_action": "confirm"}
            }
        }
        await self.feature.track("saved_action", now=self.now, alert_id="alert_1")
        result = await self.feature.resolve_action_event(
            SimpleNamespace(
                data={"action": "saved_action"},
                context=SimpleNamespace(user_id=None),
            )
        )
        self.assertEqual(result.alert["name"], "Saved")

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
        alert = SimpleNamespace(
            model_dump=lambda exclude_none=True: {"id": "alert_1", "name": "Saved"}
        )
        self.feature._alerts = {"alert_1": alert}
        self.feature._state["runtime"] = {
            "alert_1": {
                "confirmation_action_ids": {
                    "snooze": "snooze",
                    "escalate": "escalate",
                },
            }
        }
        await self.feature.track(
            "snooze",
            now=self.now,
            alert_id="alert_1",
            selection=confirmation.ConfirmationSelection(
                "snooze", "snooze", "Snooze"
            ),
        )
        await self.feature.track(
            "escalate",
            now=self.now,
            alert_id="alert_1",
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
        self.assertFalse(result.test)
        self.assertTrue(result.record_history)


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

    def test_extract_action_id_accepts_only_nonempty_mapping_actions(self):
        self.assertIsNone(confirmation.extract_action_id(None))
        self.assertIsNone(confirmation.extract_action_id({}))
        self.assertEqual(
            confirmation.extract_action_id({"action": "confirm_1"}), "confirm_1"
        )


if __name__ == "__main__":
    unittest.main()
