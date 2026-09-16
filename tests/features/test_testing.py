"""Tests for saved and draft notification test delivery."""

from __future__ import annotations

import pytest

from tests.conftest import stable_test_payloads


@pytest.mark.asyncio
async def test_saved_test_sends_all_configured_attempts(test_feature_context):
    context = test_feature_context

    assert await context.feature.test_saved("alert_1")
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

    await context.feature.test_saved("alert_1")
    await context.run_reminders()

    assert stable_test_payloads(context.notification.payloads) == snapshot


@pytest.mark.asyncio
async def test_editor_test_uses_the_same_attempt_loop(test_feature_context):
    context = test_feature_context

    result = await context.feature.test_payload(context.alert)
    await context.run_reminders()

    assert result["session_id"]
    assert [payload["attempt"] for payload in context.notification.payloads] == [
        1,
        2,
        3,
        4,
        5,
    ]
    assert all(payload["test"] for payload in context.notification.payloads)


@pytest.mark.asyncio
async def test_editor_test_delivery_contract_snapshot(test_feature_context, snapshot):
    context = test_feature_context

    await context.feature.test_payload(context.alert)
    await context.run_reminders()

    assert stable_test_payloads(context.notification.payloads) == snapshot


@pytest.mark.asyncio
async def test_confirmation_stops_pending_test_reminders(test_feature_context):
    context = test_feature_context

    await context.feature.test_saved("alert_1")
    session_id = next(iter(context.feature._draft_action_ids))
    await context.confirmation.clear(context.feature._draft_action_ids[session_id])
    await context.run_reminders()

    assert [payload["attempt"] for payload in context.notification.payloads] == [1]


@pytest.mark.asyncio
async def test_discard_stops_editor_test_reminders(test_feature_context):
    context = test_feature_context

    result = await context.feature.test_payload(context.alert)
    await context.feature.discard_payload(result["session_id"])
    await context.run_reminders()

    assert [payload["attempt"] for payload in context.notification.payloads] == [1]
