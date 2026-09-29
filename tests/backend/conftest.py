"""Shared backend fixtures loaded from canonical JSON cases."""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

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
