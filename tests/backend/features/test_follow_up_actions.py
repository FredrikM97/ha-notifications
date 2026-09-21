"""Tests for rendered follow-up service actions."""

from __future__ import annotations

import importlib
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from tests.backend.conftest import make_alert
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
module = importlib.import_module(f"{PACKAGE_NAME}.features.follow_up_actions")


class HistoryRecorder:
    def __init__(self) -> None:
        self.events = []

    def record(self, *args):
        self.events.append(args)
        return True


@pytest.fixture
def follow_up_context(hass):
    state = {"runtime": {"alert_1": {"confirmation_action_ids": {"confirm_1": "confirm"}}}}
    history = HistoryRecorder()
    feature = module.FollowUpActionsFeature(hass, state, None, SimpleNamespace(
        persist=lambda: None
    ))
    feature.lifecycle = SimpleNamespace(feature=lambda name: {"history": history}[name])
    return feature, state, history


@pytest.mark.asyncio
async def test_run_renders_and_executes_multiple_actions(
    hass, follow_up_context, snapshot
):
    feature, _state, history = follow_up_context
    calls = []

    async def handler(call):
        calls.append(call)

    hass.services.async_register("light", "turn_on", handler)
    alert = make_alert(
        post_send_actions={
            "enabled": True,
            "actions": [
                {
                    "action": "light.turn_on",
                    "target": {"entity_id": "{{ notification_id }}"},
                    "data": {"brightness": "{{ attempt * 10 }}"},
                },
                {"action": "bad-value"},
            ],
        }
    )

    await feature.run(
        alert, 2, datetime(2026, 1, 1, tzinfo=timezone.utc), False, True
    )

    assert len(calls) == 1
    assert calls[0].data["brightness"] == 20
    assert [
        {
                "index": event[3]["index"],
                "message": event[2],
                "details": event[3],
        }
        for event in history.events
    ] == snapshot


@pytest.mark.asyncio
async def test_run_records_service_failure(hass, follow_up_context):
    feature, _state, history = follow_up_context

    async def handler(_call):
        raise RuntimeError("service unavailable")

    hass.services.async_register("light", "turn_on", handler)
    await feature.run(
        make_alert(
            post_send_actions={
                "enabled": True,
                "actions": [{"action": "light.turn_on"}],
            }
        ),
        1,
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        False,
        True,
    )

    assert history.events[0][1].value == "notification_action_failed"
    assert history.events[0][3]["error"] == "service unavailable"


@pytest.mark.asyncio
async def test_run_skips_disabled_or_empty_actions(hass, follow_up_context):
    feature, _state, history = follow_up_context
    alert = make_alert(post_send_actions={"enabled": False, "actions": []})

    await feature.run(
        alert, 1, datetime(2026, 1, 1, tzinfo=timezone.utc), False, True
    )

    assert history.events == []