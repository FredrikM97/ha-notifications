"""Tests for the stateless notification preview trigger."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_preview_only_forwards_a_forced_condition_result(
    test_feature_context,
):
    context = test_feature_context
    condition_result = AsyncMock()
    context.feature.lifecycle.feature_map["conditions"].condition_result_for_alert = (
        condition_result
    )

    result = await context.feature.preview_payload(context.alert)

    assert result is True
    condition_result.assert_awaited_once()
    runtime, active, error = condition_result.await_args.args[:3]
    assert runtime.config["id"].startswith("NC_PREVIEW_")
    assert active is True
    assert error is None
    assert condition_result.await_args.kwargs["source"] == "test"


@pytest.mark.asyncio
async def test_preview_validates_payload_before_triggering(test_feature_context):
    context = test_feature_context
    condition_result = AsyncMock()
    context.feature.lifecycle.feature_map["conditions"].condition_result_for_alert = (
        condition_result
    )

    with pytest.raises(ValueError):
        await context.feature.preview_payload({"invalid": True})

    condition_result.assert_not_awaited()
