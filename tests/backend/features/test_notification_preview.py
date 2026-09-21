"""Tests for saved and draft notification test delivery."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from custom_components.ha_notifications.features.notification_preview import (
    PREVIEW_SESSION_TTL,
)
from tests.backend.conftest import stable_test_payloads


@pytest.mark.asyncio
async def test_saved_test_sends_all_configured_confirmation_attempts(
    test_feature_context,
):
    context = test_feature_context

    assert await context.feature.preview_saved("alert_1")
    await context.run_reminders()

    assert [payload["attempt"] for payload in context.notification.payloads] == [
        1,
        2,
        3,
        4,
        5,
    ]
    assert [
        payload["replace_existing"] for payload in context.notification.payloads
    ] == [False, True, True, True, True]


@pytest.mark.asyncio
async def test_saved_test_delivery_contract_snapshot(test_feature_context, snapshot):
    context = test_feature_context

    await context.feature.preview_saved("alert_1")
    await context.run_reminders()

    assert stable_test_payloads(context.notification.payloads) == snapshot


@pytest.mark.asyncio
async def test_expiry_callback_schedules_coroutine_thread_safely(
    test_feature_context,
):
    context = test_feature_context

    await context.feature.preview_saved("alert_1")
    expiry_callback = next(
        callback
        for delay, callback in context.scheduled
        if delay == PREVIEW_SESSION_TTL
    )

    assert expiry_callback(datetime.now(timezone.utc)) is None

    await asyncio.sleep(0)
    assert context.feature._sessions == {}


@pytest.mark.asyncio
async def test_editor_test_uses_the_same_attempt_loop(test_feature_context):
    context = test_feature_context

    result = await context.feature.preview_payload(context.alert)
    await context.run_reminders()

    assert result["session_id"]
    assert [payload["attempt"] for payload in context.notification.payloads] == [
        1,
        2,
        3,
        4,
        5,
    ]


@pytest.mark.asyncio
async def test_editor_test_cleans_up_when_initial_delivery_fails(
    test_feature_context, monkeypatch
):
    context = test_feature_context

    async def fail_send(payload):
        raise RuntimeError("delivery failed")

    monkeypatch.setattr(context.notification, "send", fail_send)

    with pytest.raises(RuntimeError, match="delivery failed"):
        await context.feature.preview_payload(context.alert)

    assert context.feature._sessions == {}
    assert context.confirmation._sessions == {}


@pytest.mark.asyncio
async def test_editor_test_delivery_contract_snapshot(test_feature_context, snapshot):
    context = test_feature_context

    await context.feature.preview_payload(context.alert)
    await context.run_reminders()

    assert stable_test_payloads(context.notification.payloads) == snapshot


@pytest.mark.asyncio
async def test_editor_test_is_published_as_history_event(
    hass, test_feature_context
):
    context = test_feature_context
    events = []
    hass.bus.async_listen(
        "ha_notifications_alert_event", events.append
    )

    await context.feature.preview_payload(context.alert)
    await hass.async_block_till_done()

    assert events[0].data["type"] == "test"
    assert events[0].data["alert_id"].startswith("NC_PREVIEW_")
    assert events[0].data["details"] == {}


@pytest.mark.asyncio
async def test_confirmation_stops_pending_test_reminders(test_feature_context):
    context = test_feature_context

    await context.feature.preview_saved("alert_1")
    session_id = next(iter(context.feature._sessions))
    context.feature._remove_session(session_id)
    await context.run_reminders()

    assert [payload["attempt"] for payload in context.notification.payloads] == [1]


@pytest.mark.asyncio
async def test_test_confirmation_is_published_as_history_event(
    hass, test_feature_context
):
    context = test_feature_context
    events = []
    hass.bus.async_listen("ha_notifications_alert_event", events.append)

    async def clear(_alert, _now):
        return None

    context.notification.clear = clear
    context.feature.lifecycle.feature_map["follow_up_actions"] = SimpleNamespace(
        actions_for_confirmation=lambda _alert: [],
        execute=lambda *_args: _completed(),
    )

    await context.feature.preview_saved("alert_1")
    session = next(iter(context.feature._sessions.values()))
    await context.feature._on_preview_action(
        SimpleNamespace(
            data={"action": next(iter(session.action_ids))},
            context=None,
        )
    )

    assert events[-1].data["type"] == "confirmed"
    assert events[-1].data["details"]["response_id"] == "confirm"


async def _completed():
    return None


@pytest.mark.asyncio
async def test_discard_stops_editor_test_reminders(test_feature_context):
    context = test_feature_context

    result = await context.feature.preview_payload(context.alert)
    await context.feature.discard_preview(result["session_id"])
    await context.run_reminders()

    assert [payload["attempt"] for payload in context.notification.payloads] == [1]


@pytest.mark.asyncio
async def test_expired_editor_test_removes_its_history(test_feature_context):
    context = test_feature_context

    result = await context.feature.preview_payload(context.alert)
    expiry_callback = next(
        callback
        for delay, callback in context.scheduled
        if delay == PREVIEW_SESSION_TTL
    )

    assert expiry_callback(datetime.now(timezone.utc)) is None
    await asyncio.sleep(0)

    assert context.history.removed_alert_ids == [result["session_id"]]
