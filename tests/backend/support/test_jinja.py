"""Tests for shared Home Assistant Jinja evaluation."""

from __future__ import annotations

from custom_components.ha_notifications.support.jinja import JinjaEvaluator


def test_evaluator_is_shared_for_one_hass_instance() -> None:
    class HassStub:
        pass

    hass = HassStub()

    first = JinjaEvaluator.for_hass(hass)
    second = JinjaEvaluator.for_hass(hass)

    assert first is second


def test_evaluator_handles_non_weak_referenceable_hass_stubs() -> None:
    first = JinjaEvaluator.for_hass(None)
    second = JinjaEvaluator.for_hass(None)

    assert first is not second
