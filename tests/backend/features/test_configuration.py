from __future__ import annotations

from types import MappingProxyType

import pytest

from custom_components.ha_notifications.features.configuration import (
    ConfigurationFeature,
)


@pytest.mark.asyncio
async def test_get_config_places_version_first():
    class Storage:
        async def load_raw_config(self):
            return MappingProxyType(
                {
                    "alerts": [],
                    "version": 1,
                }
            )

    feature = ConfigurationFeature(None, {}, Storage(), None)

    result = await feature.get_config()

    assert list(result) == ["version", "alerts"]


@pytest.mark.asyncio
async def test_get_config_keeps_invalid_saved_alerts_for_yaml_recovery():
    class Storage:
        async def load_raw_config(self):
            return {
                "version": 1,
                "alerts": [{"name": "Missing id"}],
            }

    feature = ConfigurationFeature(None, {}, Storage(), None)

    result = await feature.get_config()

    assert result["alerts"] == [{"name": "Missing id"}]