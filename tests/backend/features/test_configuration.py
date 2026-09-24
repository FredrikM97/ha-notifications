from __future__ import annotations

import pytest

from custom_components.ha_notifications.features.configuration import (
    ConfigurationFeature,
)


@pytest.mark.asyncio
async def test_get_config_places_version_first(hass, storage_context_factory):
    storage_context = storage_context_factory({"alerts": [], "version": 1})
    feature = ConfigurationFeature(
        hass,
        {},
        storage_context.storage,
        None,
    )

    result = await feature.get_config()

    assert list(result) == ["version", "alerts"]


@pytest.mark.asyncio
async def test_get_config_keeps_invalid_saved_alerts_for_yaml_recovery(
    hass, storage_context_factory
):
    storage_context = storage_context_factory(
        {"version": 1, "alerts": [{"name": "Missing id"}]}
    )
    feature = ConfigurationFeature(
        hass,
        {},
        storage_context.storage,
        None,
    )

    result = await feature.get_config()

    assert result["alerts"] == [{"name": "Missing id"}]