"""Shared pytest fixtures/helpers for the HA Notifications test suite.

Only holds helpers that are genuinely identical across files. Suite-specific
alert shapes (e.g. `test_controller_notifications.py`'s smaller alert, which
omits `monitor`/`conditions`/`enabled` on purpose) stay local rather than
being forced through here.
"""

from __future__ import annotations

import importlib
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from yaml import safe_load

from custom_components.ha_notifications.const import CONF_SHOW_SIDEBAR, DOMAIN

_ALERT_FIXTURES = safe_load(
    (Path(__file__).parent / "fixtures" / "alerts.yaml").read_text()
)


def make_confirmation_alert(alert_id: str = "alert_1") -> dict[str, Any]:
    """Build an alert with a short, observable confirmation reminder policy."""

    alert = deepcopy(_ALERT_FIXTURES["confirmation"])
    alert["id"] = alert_id
    return alert


def stable_test_payloads(payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize dynamic test-delivery fields before snapshot comparison."""

    normalized = deepcopy(payloads)
    for payload in normalized:
        payload["now"] = "<datetime>"
        payload["confirmation_action_id"] = "<confirmation_action_id>"
        alert_id = payload["alert"]["id"]
        if str(alert_id).startswith("NC_DRAFT_"):
            payload["alert"]["id"] = "<draft_session_id>"
    return normalized


def make_notification_alert(alert_id: str = "alert_1") -> dict[str, Any]:
    """Build the compact alert shape used by notification planner tests."""

    alert = deepcopy(_ALERT_FIXTURES["notification"])
    alert["id"] = alert_id
    return alert


def alert_fixture(name: str) -> dict[str, Any]:
    """Return a copy of a named reusable YAML alert fixture."""

    return deepcopy(_ALERT_FIXTURES[name])


def notification_snapshot(kind: str):
    """Build a deterministic registry snapshot for notification planner tests."""

    from custom_components.ha_notifications.features.notification import (
        RegistrySnapshot,
    )

    if kind == "mobile":
        return RegistrySnapshot(
            area_registry=SimpleNamespace(areas={}),
            device_registry=SimpleNamespace(devices={}),
            entity_registry=SimpleNamespace(entities={}),
            mobile_app_entries=[
                SimpleNamespace(
                    entry_id="mobile_entry",
                    data={"device_id": "phone_device", "device_name": "somebody"},
                )
            ],
            person_states=[],
        )
    if kind == "mobile_device":
        return RegistrySnapshot(
            area_registry=SimpleNamespace(areas={}),
            device_registry=SimpleNamespace(
                devices={
                    "phone_device": SimpleNamespace(
                        id="phone_device",
                        area_id=None,
                        labels=set(),
                        config_entries={"mobile_entry"},
                    )
                }
            ),
            entity_registry=SimpleNamespace(entities={}),
            mobile_app_entries=[
                SimpleNamespace(
                    entry_id="mobile_entry", data={"device_name": "somebody"}
                )
            ],
            person_states=[],
        )
    if kind == "empty":
        return RegistrySnapshot(
            area_registry=SimpleNamespace(areas={}),
            device_registry=SimpleNamespace(devices={}),
            entity_registry=SimpleNamespace(
                entities={
                    "notify.somebody": SimpleNamespace(
                        entity_id="notify.somebody",
                        device_id=None,
                        config_entry_id="mobile_entry",
                        area_id=None,
                        labels=set(),
                    )
                }
            ),
            mobile_app_entries=[
                SimpleNamespace(
                    entry_id="mobile_entry", data={"device_name": "somebody"}
                )
            ],
            person_states=[],
        )
    if kind == "labeled":
        return RegistrySnapshot(
            area_registry=SimpleNamespace(areas={}),
            device_registry=SimpleNamespace(devices={}),
            entity_registry=SimpleNamespace(entities={}),
            mobile_app_entries=[],
            person_states=[],
        )
    raise ValueError(f"Unknown notification snapshot kind: {kind}")


class _TestNotification:
    def __init__(self) -> None:
        self.payloads: list[dict[str, Any]] = []

    async def send(self, payload: dict[str, Any]) -> None:
        self.payloads.append(payload)


class _TestAlerts:
    def __init__(self, saved_alert: dict[str, Any]) -> None:
        self.saved_alert = saved_alert

    async def get_alert(self, alert_id: str) -> dict[str, Any] | None:
        if alert_id == self.saved_alert["id"]:
            return self.saved_alert
        return None


class _TestLifecycle:
    def __init__(self, feature_map: dict[str, Any]) -> None:
        self.feature_map = feature_map

    def feature(self, name: str) -> Any:
        return self.feature_map[name]


@pytest.fixture
def test_feature_context(hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch):
    """Provide a real HA context and captured delivery/timer test features."""

    confirmation = importlib.import_module(
        "custom_components.ha_notifications.features.confirmation"
    )
    testing = importlib.import_module(
        "custom_components.ha_notifications.features.testing"
    )
    saved_alert = make_confirmation_alert()
    notification = _TestNotification()
    confirmation_feature = confirmation.ConfirmationFeature(hass, {}, None, None)
    test_feature = testing.TestFeature(hass, {}, None, None)
    scheduled: list[tuple[Any, Any]] = []

    def schedule(_hass: HomeAssistant, delay: Any, callback: Any):
        scheduled.append((delay, callback))

        def cancel() -> None:
            scheduled[:] = [
                item for item in scheduled if item[1] is not callback
            ]

        return cancel

    monkeypatch.setattr(testing, "async_call_later", schedule)
    test_feature.lifecycle = _TestLifecycle(
        {
            "alerts": _TestAlerts(saved_alert),
            "confirmation": confirmation_feature,
            "notification": notification,
        }
    )

    async def run_reminders() -> None:
        while scheduled and len(notification.payloads) < 5:
            index = min(range(len(scheduled)), key=lambda item: scheduled[item][0])
            _, callback = scheduled.pop(index)
            await callback(datetime.now(timezone.utc))

    return SimpleNamespace(
        alert=saved_alert,
        confirmation=confirmation_feature,
        feature=test_feature,
        notification=notification,
        scheduled=scheduled,
        run_reminders=run_reminders,
    )


def make_alert(alert_id: str = "alert_1", **overrides: Any) -> dict[str, Any]:
    """Build a full alert dict for controller/alerts.py and controller/core.py tests."""

    base = deepcopy(_ALERT_FIXTURES["base"])
    base["id"] = alert_id
    base.update(overrides)
    return base


def make_runtime_state(**overrides: Any) -> dict[str, Any]:
    """Build a complete default runtime record with focused test overrides."""

    runtime = {
        "active": False,
        "acknowledged": False,
        "attempts": 0,
        "notification_id": None,
        "confirmation_action_id": None,
        "flow_id": None,
        "started_at": None,
        "last_evaluated": None,
        "last_notified": None,
        "confirmed_at": None,
        "confirmed_by": None,
        "last_error": None,
        "last_event": None,
    }
    runtime.update(overrides)
    return runtime


@pytest.fixture
def mock_config_entry() -> MockConfigEntry:
    """Return a minimal HA Notifications config entry."""
    return MockConfigEntry(
        domain=DOMAIN,
        title="HA Notifications",
        data={CONF_SHOW_SIDEBAR: False},
    )


@pytest.fixture
async def loaded_config_entry(
    hass: HomeAssistant,
    mock_config_entry: MockConfigEntry,
) -> MockConfigEntry:
    """Load and settle a minimal HA Notifications config entry."""
    mock_config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(mock_config_entry.entry_id)
    await hass.async_block_till_done()
    return mock_config_entry
