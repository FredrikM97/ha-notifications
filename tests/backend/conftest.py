"""Shared backend fixtures loaded from canonical JSON cases."""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import yaml

_ALERT_FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "alerts.json").read_text()
)


def alert_fixture(name: str) -> dict[str, Any]:
    """Return a copy of a named canonical alert fixture."""
    return deepcopy(_ALERT_FIXTURES[name])


@pytest.fixture
def backend_alerts() -> dict[str, dict[str, Any]]:
    """Load reusable canonical alert fixtures."""
    return deepcopy(_ALERT_FIXTURES)


@pytest.fixture
def alert_factory():
    """Build a canonical alert with focused overrides."""

    def build_alert(name: str = "base", **overrides: Any) -> dict[str, Any]:
        alert = alert_fixture(name)
        alert.update(overrides)
        return alert

    return build_alert


@pytest.fixture
def full_feature_alert() -> dict[str, Any]:
    """Return the canonical full-feature automation case."""
    return alert_fixture("full_feature")


@pytest.fixture
def mock_automation_files(hass):
    """Prepare and inspect isolated Home Assistant automation config files."""
    configuration_path = Path(hass.config.path("configuration.yaml"))
    automation_path = Path(hass.config.path("ha_notifications_automations.yaml"))

    def prepare(*, include: bool = True) -> None:
        configuration = (
            "automation ha_notifications: !include "
            "ha_notifications_automations.yaml\n"
            if include
            else ""
        )
        configuration_path.write_text(configuration)
        automation_path.write_text("[]\n")

    def read_automations() -> list[dict[str, Any]]:
        return yaml.safe_load(automation_path.read_text())

    return {"prepare": prepare, "read_automations": read_automations}
