"""Shared pytest fixtures/helpers for the HA Notifications test suite.

Only holds helpers that are genuinely identical across files. Suite-specific
alert shapes (e.g. `test_controller_notifications.py`'s smaller alert, which
omits `monitor`/`conditions`/`enabled` on purpose) stay local rather than
being forced through here.
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_mock_service,
)
from yaml import safe_load

import custom_components.ha_notifications  # noqa: F401
from custom_components.ha_notifications.const import CONF_SHOW_SIDEBAR, DOMAIN
from custom_components.ha_notifications.domain.confirmation import (
    PendingConfirmationState,
)
from custom_components.ha_notifications.domain.runtime import (
    AlertRuntimeState,
)
from custom_components.ha_notifications.support.storage import Storage

_ALERT_FIXTURES = safe_load(
    (Path(__file__).parent / "fixtures" / "alerts.yaml").read_text()
)


def stable_test_payloads(payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize dynamic test-delivery fields before snapshot comparison."""

    normalized = deepcopy(payloads)
    for payload in normalized:
        payload["now"] = "<datetime>"
        payload.pop("condition_facts", None)
        payload.pop("trigger_source", None)
        payload["notification_actions"] = [
            {
                "action": f"<confirmation_action_{index}>",
                "title": action["title"],
            }
            for index, action in enumerate(
                payload.get("notification_actions", []),
                start=1,
            )
        ]
        alert_id = payload["alert"]["id"]
        if str(alert_id).startswith("NC_PREVIEW_"):
            payload["alert"]["id"] = "<draft_session_id>"
    return normalized


def alert_fixture(name: str) -> dict[str, Any]:
    """Return a copy of a named reusable YAML alert fixture."""

    return deepcopy(_ALERT_FIXTURES[name])


@pytest.fixture
def real_target_registry(hass: HomeAssistant):
    """Populate real Home Assistant registries for target-resolution tests."""

    from homeassistant.helpers import area_registry as ar
    from homeassistant.helpers import device_registry as dr
    from homeassistant.helpers import entity_registry as er

    from custom_components.ha_notifications.delivery.targets import RegistrySnapshot

    mobile_entry = MockConfigEntry(
        domain="mobile_app",
        entry_id="mobile_entry",
        data={
            "user_id": "user_1",
            "device_id": "device_1",
            "device_name": "phone",
        },
    )
    mobile_entry.add_to_hass(hass)
    async_mock_service(hass, "notify", "mobile_app_phone")

    area = ar.async_get(hass).async_create("Living Room", floor_id="floor_1")
    device_registry = dr.async_get(hass)
    device = device_registry.async_get_or_create(
        config_entry_id=mobile_entry.entry_id,
        identifiers={("mobile_app", "device_1")},
        name="phone",
    )
    device = device_registry.async_update_device(
        device.id,
        area_id=area.id,
        labels={"critical"},
    )
    entity_registry = er.async_get(hass)
    tracker = entity_registry.async_get_or_create(
        "sensor",
        "mobile_app",
        "tracker",
        suggested_object_id="tracker",
        device_id=device.id,
    )
    notify_entity = entity_registry.async_get_or_create(
        "notify",
        "mobile_app",
        "phone",
        suggested_object_id="phone",
        config_entry=mobile_entry,
        device_id=device.id,
    )
    hass.states.async_set(
        "person.user",
        "home",
        {"user_id": "user_1", "device_trackers": [tracker.entity_id]},
    )

    return SimpleNamespace(
        snapshot=RegistrySnapshot(
            area_registry=ar.async_get(hass),
            device_registry=device_registry,
            entity_registry=entity_registry,
            mobile_app_entries=[mobile_entry],
            person_states=list(hass.states.async_all("person")),
            has_service=hass.services.has_service,
        ),
        area_id=area.id,
        device_id=device.id,
        notify_entity_id=notify_entity.entity_id,
    )


@pytest.fixture
def alert_factory():
    """Provide the full alert builder for tests with focused overrides."""

    def build_alert(alert_id: str = "alert_1", **overrides: Any) -> dict[str, Any]:
        base = deepcopy(_ALERT_FIXTURES["base"])
        base["id"] = alert_id
        base.update(overrides)
        return base

    return build_alert


@pytest.fixture
def alert(alert_factory) -> dict[str, Any]:
    """Provide a fresh full alert configuration for each test."""

    return alert_factory()


@pytest.fixture
def confirmation_alert_factory():
    """Provide the confirmation alert builder for tests with focused overrides."""

    def build_confirmation_alert(alert_id: str = "alert_1") -> dict[str, Any]:
        alert = deepcopy(_ALERT_FIXTURES["confirmation"])
        alert["id"] = alert_id
        return alert

    return build_confirmation_alert


@pytest.fixture
def notification_alert_factory():
    """Provide the notification alert builder for tests with focused overrides."""

    def build_notification_alert(alert_id: str = "alert_1") -> dict[str, Any]:
        alert = deepcopy(_ALERT_FIXTURES["notification"])
        alert["id"] = alert_id
        return alert

    return build_notification_alert


@pytest.fixture
def confirmation_alert(
    real_target_registry, confirmation_alert_factory
) -> dict[str, Any]:
    """Provide a confirmation alert targeting the real mobile entity."""

    configured_alert = confirmation_alert_factory()
    configured_alert["notification"]["target"] = {
        "entity_id": [real_target_registry.notify_entity_id]
    }
    return configured_alert


@pytest.fixture
def notification_alert(
    real_target_registry, notification_alert_factory
) -> dict[str, Any]:
    """Provide a notification alert targeting the real mobile entity."""

    configured_alert = notification_alert_factory()
    configured_alert["notification"]["target"] = {
        "entity_id": [real_target_registry.notify_entity_id]
    }
    return configured_alert


@pytest.fixture
def registry_snapshot(real_target_registry):
    """Provide the real Home Assistant registry snapshot."""

    return real_target_registry.snapshot


@pytest.fixture
def runtime_state(runtime_state_factory) -> AlertRuntimeState:
    """Provide a fresh runtime state for each test."""

    return runtime_state_factory()


@pytest.fixture
def runtime_state_factory():
    """Provide the runtime state builder for tests with focused overrides."""

    def build_runtime_state(**overrides: Any) -> AlertRuntimeState:
        config = overrides.pop("alert", deepcopy(_ALERT_FIXTURES["base"]))
        state = dict(overrides.pop("state", {}))
        confirmation = overrides.pop("confirmation", {})
        condition = overrides.pop("condition", {})
        notification = overrides.pop("notification", {})
        for key in ("active", "last_evaluated", "flow_id", "started_at"):
            if key in overrides:
                state[key] = overrides.pop(key)
        for key in ("last_notified", "last_error"):
            if key in overrides:
                state[key] = overrides.pop(key)
        state.update(condition)
        state.update(notification)
        if state.get("active") or state.get("last_evaluated"):
            state.setdefault(
                "last_evaluated",
                condition.get("last_evaluated")
                or condition.get("started_at")
                or "2026-01-01T00:00:00+00:00",
            )
        runtime = AlertRuntimeState(config=config, state=state, **overrides)
        if confirmation:
            runtime.record_event(PendingConfirmationState(**confirmation))
        return runtime

    return build_runtime_state


@pytest.fixture
def runtime_with_pending_factory():
    """Build runtime state with an explicit pending confirmation event."""

    def build_runtime(alert: dict[str, Any] | None = None, **pending: Any):
        runtime = AlertRuntimeState.for_alert(alert or {"id": "alert_1"})
        runtime.record_event(PendingConfirmationState(**pending))
        return runtime

    return build_runtime


@pytest.fixture
def storage_context_factory(hass: HomeAssistant):
    """Build a real Storage instance with a test config entry."""

    def build_context(options: dict[str, Any] | None = None):
        entry = MockConfigEntry(domain=DOMAIN, data={}, options=options or {})
        entry.add_to_hass(hass)
        return SimpleNamespace(entry=entry, storage=Storage(hass, entry))

    return build_context


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

@pytest.fixture(scope="session", autouse=True)
def frontend_file():
    """Auto load frontend to always have a dummy panel.js available"""
    FRONTEND_FILE = (
        Path.cwd()
        / "custom_components"
        / "ha_notifications"
        / "frontend"
        / "panel.js"
    )
    print(f"Creating frontend file at {FRONTEND_FILE}")
    FRONTEND_FILE.parent.mkdir(parents=True, exist_ok=True)
    FRONTEND_FILE.write_text("// Test frontend\n")

    yield

    FRONTEND_FILE.unlink(missing_ok=True)