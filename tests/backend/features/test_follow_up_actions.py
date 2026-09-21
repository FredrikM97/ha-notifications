"""Tests for rendered follow-up service actions."""

from __future__ import annotations

import importlib
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from custom_components.ha_notifications.const import EVENT_ALERT_EVENT, AlertEventType
from custom_components.ha_notifications.domain.service_calls import (
    ServiceEffectsRequest,
)
from tests.backend.conftest import make_alert
from tests.backend.support.test_support import PACKAGE_NAME, ensure_package

ensure_package()
module = importlib.import_module(f"{PACKAGE_NAME}.features.follow_up_actions")


class HistoryRecorder:
    def __init__(self) -> None:
        self.events = []


def test_actions_for_confirmation_reads_owned_configuration():
    alert = make_alert(
        confirmation={
            "enabled": True,
            "actions": {
                "enabled": True,
                "items": [{"action": "light.turn_on"}],
            },
        }
    )

    assert module.FollowUpActionsFeature.actions_for_confirmation(alert) == [
        {"action": "light.turn_on"}
    ]


@pytest.fixture
def follow_up_context(hass):
    history = HistoryRecorder()
    hass.bus.async_listen(
        EVENT_ALERT_EVENT,
        lambda event: history.events.append(
            SimpleNamespace(
                event_type=AlertEventType(event.data["type"]),
                message=event.data["message"],
                details=event.data["details"],
                error=event.data["error"],
            )
        ),
    )
    feature = module.FollowUpActionsFeature(
        hass, {}, None, SimpleNamespace(persist=lambda: None)
    )
    return feature, history


@pytest.mark.asyncio
async def test_run_renders_and_executes_multiple_actions(
    hass, follow_up_context, snapshot
):
    feature, history = follow_up_context
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
                    "target": {"entity_id": "light.kitchen"},
                    "data": {"brightness": 20},
                },
                {"action": "bad-value"},
            ],
        }
    )

    await feature.execute(
        ServiceEffectsRequest(
            alert, datetime(2026, 1, 1, tzinfo=timezone.utc), attempt=2
        )
    )

    await hass.async_block_till_done()
    assert len(calls) == 1
    assert calls[0].data["brightness"] == 20
    assert [
        {
            "message": event.message,
            "details": event.details,
            "error": event.error,
        }
        for event in history.events
    ] == snapshot


@pytest.mark.asyncio
async def test_run_records_service_failure(hass, follow_up_context):
    feature, history = follow_up_context

    async def handler(_call):
        raise RuntimeError("service unavailable")

    hass.services.async_register("light", "turn_on", handler)
    await feature.execute(
        ServiceEffectsRequest(
            make_alert(
                post_send_actions={
                    "enabled": True,
                    "actions": [{"action": "light.turn_on"}],
                }
            ),
            datetime(2026, 1, 1, tzinfo=timezone.utc),
            attempt=1,
        ),
    )
    await hass.async_block_till_done()

    assert history.events[0].event_type.value == "notification_action_failed"
    assert history.events[0].error == "service unavailable"


@pytest.mark.asyncio
async def test_run_skips_disabled_or_empty_actions(hass, follow_up_context):
    feature, history = follow_up_context
    alert = make_alert(post_send_actions={"enabled": False, "actions": []})

    await feature.execute(
        ServiceEffectsRequest(
            alert, datetime(2026, 1, 1, tzinfo=timezone.utc), attempt=1
        )
    )

    assert history.events == []


@pytest.mark.asyncio
@pytest.mark.parametrize("service", [".", "notify.", ".send"])
async def test_run_records_malformed_service_names(
    hass, follow_up_context, service
):
    feature, history = follow_up_context

    await feature.execute(
        ServiceEffectsRequest(
            make_alert(
                post_send_actions={
                    "enabled": True,
                    "actions": [{"action": service}],
                }
            ),
            datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
    )

    assert history.events[0].event_type == AlertEventType.NOTIFICATION_ACTION_FAILED
    assert history.events[0].error == "Invalid service action."


@pytest.mark.asyncio
async def test_run_records_non_mapping_data(hass, follow_up_context):
    feature, history = follow_up_context

    await feature.execute(
        ServiceEffectsRequest(
            make_alert(
                post_send_actions={
                    "enabled": True,
                    "actions": [
                        {"action": "light.turn_on", "data": "invalid"}
                    ],
                }
            ),
            datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
    )

    assert history.events[0].event_type == AlertEventType.NOTIFICATION_ACTION_FAILED
    assert (
        history.events[0].error
        == "Service action data must be a mapping."
    )