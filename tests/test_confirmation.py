"""Tests for the feature-owned confirmation configuration and workflow helpers."""

from __future__ import annotations

import asyncio
import importlib
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from test_support import PACKAGE_NAME, ensure_package

ensure_package()
confirmation = importlib.import_module(f"{PACKAGE_NAME}.features.confirmation")


class ConfirmationConfigTests(unittest.TestCase):
    def test_confirmation_defaults_are_owned_by_confirmation_feature(self):
        config = confirmation.confirmation_config({"enabled": True})

        self.assertTrue(config.enabled)
        self.assertTrue(config.reminders.enabled)
        self.assertFalse(config.notification.enabled)
        self.assertFalse(config.actions.enabled)

    def test_confirmation_is_read_from_alert_level(self):
        alert = {"confirmation": {"enabled": True, "button": "Done"}}

        config = confirmation.confirmation_for_alert(alert)

        self.assertIsNotNone(config)
        self.assertEqual(config.button, "Done")


class ConfirmationFeatureTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.sessions = {}
        self.feature = confirmation.ConfirmationFeature(
            None,
            {},
        )
        self.sessions = self.feature._sessions
        self.now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    async def test_prepare_action_requires_enabled_confirmation(self):
        runtime = {}

        created, action_id = await self.feature.prepare_action(
            {"id": "alert_1", "confirmation": {"enabled": False}}, runtime
        )

        self.assertFalse(created)
        self.assertIsNone(action_id)
        self.assertEqual(runtime, {})

    async def test_prepare_action_is_idempotent_for_pending_action(self):
        runtime = {}
        alert = {"id": "alert_1", "confirmation": {"enabled": True}}

        created, action_id = await self.feature.prepare_action(alert, runtime)
        repeated, repeated_id = await self.feature.prepare_action(alert, runtime)

        self.assertTrue(created)
        self.assertTrue(action_id.startswith("NC_CONFIRM_alert_1_"))
        self.assertFalse(repeated)
        self.assertEqual(repeated_id, action_id)

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


if __name__ == "__main__":
    unittest.main()
