"""Unit tests for controller/responses.py - pending confirmation tracking."""

from __future__ import annotations

import asyncio
import importlib
import unittest
from datetime import datetime, timedelta, timezone

from test_support import PACKAGE_NAME, ensure_package

ensure_package()
responses = importlib.import_module(f"{PACKAGE_NAME}.features.confirmation")


class TrackClearTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    def test_track_real_alert_has_no_expiry(self):
        sessions = {}
        responses.track(sessions, "action_1", now=self.now, alert_id="alert_1")
        self.assertIsInstance(sessions["action_1"], responses.ConfirmationSession)
        self.assertIsNone(sessions["action_1"].expires_at)
        self.assertEqual(sessions["action_1"].alert_id, "alert_1")

    def test_track_draft_gets_ttl_expiry(self):
        sessions = {}
        draft = {"id": "session_x", "name": "Draft"}
        responses.track(
            sessions,
            "session_x",
            now=self.now,
            draft_alert=draft,
            ttl=responses.DRAFT_SESSION_TTL,
        )
        session = sessions["session_x"]
        self.assertEqual(session.expires_at, self.now + responses.DRAFT_SESSION_TTL)
        self.assertEqual(session.draft_alert["id"], "session_x")

    def test_draft_alert_is_deep_copied(self):
        sessions = {}
        draft = {"name": "Draft"}
        responses.track(sessions, "s", now=self.now, draft_alert=draft)
        draft["name"] = "Changed"
        self.assertEqual(sessions["s"].draft_alert["name"], "Draft")

    def test_clear_removes_session(self):
        sessions = {"a": {}}
        responses.clear(sessions, "a")
        self.assertNotIn("a", sessions)

    def test_clear_missing_session_is_a_no_op(self):
        sessions = {}
        responses.clear(sessions, "missing")  # should not raise


class ExpireDraftsTests(unittest.TestCase):
    def test_only_expired_drafts_are_removed(self):
        now = datetime(2024, 1, 1, tzinfo=timezone.utc)
        sessions = {
            "expired": responses.ConfirmationSession(
                created_at=now, expires_at=now - timedelta(minutes=1)
            ),
            "still_good": responses.ConfirmationSession(
                created_at=now, expires_at=now + timedelta(minutes=1)
            ),
            "real_alert": responses.ConfirmationSession(created_at=now),
        }
        removed = responses.expire_drafts(sessions, now)
        self.assertEqual(removed, ["expired"])
        self.assertNotIn("expired", sessions)
        self.assertIn("still_good", sessions)
        self.assertIn("real_alert", sessions)


class MatchActionEventTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    def test_matches_real_alert_session(self):
        sessions = {}
        responses.track(sessions, "action_1", now=self.now, alert_id="alert_1")
        outcome = responses.match_action_event(
            sessions, {"action": "action_1"}, self.now
        )
        self.assertEqual(outcome.alert_id, "alert_1")
        self.assertFalse(outcome.is_draft)

    def test_matches_draft_session(self):
        sessions = {}
        responses.track(
            sessions,
            "s",
            now=self.now,
            draft_alert={"id": "s"},
            ttl=responses.DRAFT_SESSION_TTL,
        )
        outcome = responses.match_action_event(sessions, {"action": "s"}, self.now)
        self.assertTrue(outcome.is_draft)
        self.assertEqual(outcome.draft_alert["id"], "s")

    def test_no_action_in_event_returns_none(self):
        self.assertIsNone(responses.match_action_event({}, {}, self.now))

    def test_unknown_action_returns_none(self):
        self.assertIsNone(
            responses.match_action_event({}, {"action": "nope"}, self.now)
        )

    def test_expired_draft_no_longer_matches(self):
        sessions = {}
        responses.track(
            sessions,
            "s",
            now=self.now,
            draft_alert={"id": "s"},
            ttl=timedelta(minutes=1),
        )
        later = self.now + timedelta(minutes=2)
        outcome = responses.match_action_event(sessions, {"action": "s"}, later)
        self.assertIsNone(outcome)


class DirectActionHandlingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.now = datetime(2024, 1, 1, tzinfo=timezone.utc)

    def _access(self, sessions, alert=None, state=None):
        async def get_person_states():
            return []

        async def get_alert(_alert_id):
            return alert

        async def get_runtime_state(_alert_id):
            return state

        return responses.ConfirmationActionAccess(
            sessions=sessions,
            get_person_states=get_person_states,
            get_alert=get_alert,
            get_runtime_state=get_runtime_state,
        )

    async def test_draft_action_returns_confirmation_fact_and_clears_session(self):
        draft = {"id": "draft", "name": "Draft"}
        sessions = {}
        responses.track(
            sessions,
            "action",
            now=self.now,
            draft_alert=draft,
            ttl=responses.DRAFT_SESSION_TTL,
        )

        result = await responses.handle_action_event(
            {"action": "action"},
            None,
            self.now,
            self._access(sessions),
        )

        self.assertNotIn("action", sessions)
        self.assertIsNotNone(result)
        self.assertTrue(result.test)

    async def test_stale_real_action_is_rejected_without_clearing_session(self):
        alert = {"id": "alert", "name": "Alert", "notification": {}}
        sessions = {
            "action": responses.ConfirmationSession(
                alert_id="alert", created_at=self.now
            )
        }
        state = {"confirmation_action_id": "newer-action"}

        result = await responses.handle_action_event(
            {"action": "action"},
            None,
            self.now,
            self._access(sessions, alert, state),
        )

        self.assertIsNone(result)
        self.assertIn("action", sessions)

    async def test_real_action_emits_acknowledgement_before_effects_fact(self):
        alert = {"id": "alert", "name": "Alert", "notification": {}}
        sessions = {}
        responses.track(sessions, "action", now=self.now, alert_id="alert")
        state = {"confirmation_action_id": "action"}

        result = await responses.handle_action_event(
            {"action": "action"},
            None,
            self.now,
            self._access(sessions, alert, state),
        )

        self.assertNotIn("action", sessions)
        self.assertEqual(result.alert, alert)
        self.assertFalse(result.test)


class ResolvePersonNameTests(unittest.TestCase):
    def test_resolves_matching_person(self):
        class FakeState:
            def __init__(self, user_id, name):
                self.attributes = {"user_id": user_id}
                self.name = name

        states = [FakeState("u1", "Alice"), FakeState("u2", "Bob")]
        self.assertEqual(responses.resolve_person_name(states, "u2"), "Bob")

    def test_unknown_user_returns_placeholder(self):
        self.assertEqual(responses.resolve_person_name([], "u1"), "Unknown user")

    def test_no_user_id_returns_placeholder(self):
        self.assertEqual(responses.resolve_person_name([], None), "Unknown user")

    def test_auth_user_fallback_resolves_without_person_entity(self):
        class FakeAuth:
            async def async_get_user(self, _user_id):
                return type("User", (), {"name": "Carol"})()

        class FakeHass:
            auth = FakeAuth()

        result = asyncio.run(
            responses.resolve_confirmed_by(FakeHass(), [], "u3")
        )
        self.assertEqual(result, "Carol")


class BuildCompletionAlertTests(unittest.IsolatedAsyncioTestCase):
    async def _render(self, source: str, variables: dict):
        return source.replace("{{ confirmed_by }}", variables.get("confirmed_by", ""))

    async def test_returns_none_when_nothing_configured(self):
        alert = {
            "id": "a1",
            "name": "Alert",
            "notification": {"confirmation": {}},
        }
        result = await responses.build_completion_alert(
            alert, "Alice", datetime(2024, 1, 1), self._render
        )
        self.assertIsNone(result)

    async def test_uses_completion_message_when_set(self):
        alert = {
            "id": "a1",
            "name": "Alert",
            "notification": {
                "confirmation": {
                    "completion_message": "Done by {{ confirmed_by }}",
                    "notify_on_confirmation": True,
                }
            },
        }
        result = await responses.build_completion_alert(
            alert, "Alice", datetime(2024, 1, 1), self._render
        )
        self.assertEqual(result["notification"]["message"], "Done by Alice")
        self.assertFalse(result["notification"]["confirmation"]["enabled"])

    async def test_ignores_completion_message_when_notifications_are_disabled(self):
        alert = {
            "id": "a1",
            "name": "Alert",
            "notification": {
                "confirmation": {"completion_message": "Do not send this"}
            },
        }
        result = await responses.build_completion_alert(
            alert, "Alice", datetime(2024, 1, 1), self._render
        )
        self.assertIsNone(result)

    async def test_notify_on_confirmation_falls_back_to_default_message(self):
        alert = {
            "id": "a1",
            "name": "Alert",
            "notification": {"confirmation": {"notify_on_confirmation": True}},
        }
        result = await responses.build_completion_alert(
            alert, "Alice", datetime(2024, 1, 1), self._render
        )
        self.assertEqual(
            result["notification"]["message"], "Alice confirmed this notification."
        )


if __name__ == "__main__":
    unittest.main()
