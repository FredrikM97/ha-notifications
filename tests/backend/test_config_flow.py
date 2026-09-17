"""Integration tests for the Home Assistant config flow."""

from __future__ import annotations

import pytest
from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from syrupy.assertion import SnapshotAssertion

from backend.const import CONF_SHOW_SIDEBAR, DOMAIN


def stable_flow_result(result: dict) -> dict:
    """Keep generated IDs and object reprs out of config-flow snapshots."""
    stable = {
        "type": result["type"],
        "handler": result["handler"],
    }
    if result["type"] == "form":
        stable.update(
            {
                "step_id": result["step_id"],
                "data_schema": str(result["data_schema"]),
            }
        )
    else:
        stable.update(
            {
                "title": result["title"],
                "data": result["data"],
                "version": result["version"],
                "minor_version": result["minor_version"],
            }
        )
    return stable


@pytest.mark.usefixtures("enable_custom_integrations")
async def test_user_flow_schema_and_entry(
    hass: HomeAssistant,
    snapshot: SnapshotAssertion,
) -> None:
    """The user flow exposes the expected form and creates an entry."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_USER},
    )
    assert stable_flow_result(result) == snapshot

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        user_input={CONF_SHOW_SIDEBAR: True},
    )

    assert stable_flow_result(result) == snapshot