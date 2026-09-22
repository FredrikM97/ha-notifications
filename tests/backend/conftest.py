"""Shared pytest fixtures/helpers for the HA Notifications test suite.

Only holds helpers that are genuinely identical across files. Suite-specific
alert shapes (e.g. `test_controller_notifications.py`'s smaller alert, which
omits `monitor`/`conditions`/`enabled` on purpose) stay local rather than
being forced through here.
"""

from __future__ import annotations

import importlib
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry
from yaml import safe_load

import custom_components.ha_notifications  # noqa: F401
from custom_components.ha_notifications.const import CONF_SHOW_SIDEBAR, DOMAIN
from custom_components.ha_notifications.domain.workflow import NotificationOutcome

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


def target_registry_snapshot():
    """Build registries covering user, device, area, floor, and label targets."""

    from custom_components.ha_notifications.delivery.targets import RegistrySnapshot

    return RegistrySnapshot(
        area_registry=SimpleNamespace(
            areas={
                "area_1": SimpleNamespace(area_id="area_1", floor_id="floor_1")
            }
        ),
        device_registry=SimpleNamespace(
            devices={
                "device_1": SimpleNamespace(
                    id="device_1",
                    area_id="area_1",
                    labels={"critical"},
                    config_entries={"mobile_entry"},
                )
            }
        ),
        entity_registry=SimpleNamespace(
            entities={
                "sensor.tracker": SimpleNamespace(
                    entity_id="sensor.tracker",
                    device_id="device_1",
                    config_entry_id=None,
                ),
                "notify.phone": SimpleNamespace(
                    entity_id="notify.phone",
                    device_id="device_1",
                    config_entry_id="mobile_entry",
                ),
            }
        ),
        mobile_app_entries=[
            SimpleNamespace(
                entry_id="mobile_entry",
                data={
                    "user_id": "user_1",
                    "device_id": "device_1",
                    "device_name": "phone",
                },
            )
        ],
        person_states=[
            SimpleNamespace(
                attributes={
                    "user_id": "user_1",
                    "device_trackers": ["sensor.tracker"],
                }
            )
        ],
        has_service=lambda domain, service: domain == "notify"
        and service == "mobile_app_phone",
    )


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
    hass.services.async_register("notify", "mobile_app_phone", lambda _call: None)

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


class _TestNotification:
    def __init__(self) -> None:
        self.payloads: list[dict[str, Any]] = []
        self.cleared: list[dict[str, Any]] = []

    async def send(self, request: Any) -> NotificationOutcome:
        self.payloads.append(
            {
                "alert": dict(request.alert),
                "attempt": request.attempt,
                "notification_actions": list(request.notification_actions),
                "replace_existing": request.replace_existing,
                "now": request.now,
                "condition_facts": dict(request.condition_facts),
                "trigger_source": request.trigger_source,
            }
        )
        return NotificationOutcome(request.attempt, request.now, True)

    async def clear(self, alert: dict[str, Any], now: Any) -> None:
        self.cleared.append({"alert": dict(alert), "now": now})


class _TestAlerts:
    def __init__(
        self, saved_alert: dict[str, Any], runtime: dict[str, dict[str, Any]]
    ) -> None:
        self.saved_alert = saved_alert
        self._runtime = runtime

    async def get_alert(self, alert_id: str) -> dict[str, Any] | None:
        if alert_id == self.saved_alert["id"]:
            return self.saved_alert
        return None

    def record_delivery_result(
        self,
        _alert_id: str,
        _attempt: int | None,
        _now: Any,
        *,
        success: bool,
        error: str | None = None,
    ) -> None:
        return None

    def runtime(self, alert_id: str) -> dict[str, Any]:
        return self._runtime.setdefault(alert_id, {})


class _TestHistory:
    def __init__(self) -> None:
        self.removed_alert_ids: list[str] = []

    async def remove_alert(self, alert_id: str) -> None:
        self.removed_alert_ids.append(alert_id)


class _TestLifecycle:
    def __init__(self, feature_map: dict[str, Any]) -> None:
        self.feature_map = feature_map

    def feature(self, name: str) -> Any:
        return self.feature_map[name]


@pytest.fixture
def test_feature_context(hass: HomeAssistant):
    """Provide a real HA context and captured delivery test features."""

    confirmation = importlib.import_module(
        "custom_components.ha_notifications.features.confirmations"
    )
    preview = importlib.import_module(
        "custom_components.ha_notifications.features.notification_preview"
    )
    alert_flow = importlib.import_module(
        "custom_components.ha_notifications.features.alert_flow"
    )
    conditions = importlib.import_module(
        "custom_components.ha_notifications.features.conditions"
    )
    follow_up_actions = importlib.import_module(
        "custom_components.ha_notifications.features.follow_up_actions"
    )
    saved_alert = make_confirmation_alert()
    state = {"runtime": {}}
    notification = _TestNotification()
    history = _TestHistory()
    confirmation_feature = confirmation.ConfirmationFeature(
        hass, state, None, None
    )
    storage = SimpleNamespace(persist=lambda: None)
    follow_up_feature = follow_up_actions.FollowUpActionsFeature(
        hass, state, None, storage
    )
    alert_flow_feature = alert_flow.AlertFlow(hass, state, None, storage)
    conditions_feature = conditions.ConditionFeature(hass, state, None, None)
    test_feature = preview.NotificationPreviewFeature(
        hass, state, None, storage
    )
    lifecycle = _TestLifecycle(
        {
            "alerts": _TestAlerts(saved_alert, state["runtime"]),
            "alert_flow": alert_flow_feature,
            "conditions": conditions_feature,
            "history": history,
            "confirmations": confirmation_feature,
            "notification": notification,
            "follow_up_actions": follow_up_feature,
        }
    )
    test_feature.lifecycle = lifecycle
    alert_flow_feature.lifecycle = lifecycle
    conditions_feature.lifecycle = lifecycle

    return SimpleNamespace(
        alert=saved_alert,
        confirmation=confirmation_feature,
        feature=test_feature,
        notification=notification,
        history=history,
        state=state,
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
        "confirmation": {"action_ids": {}, "attempts": 0},
        "notification_id": None,
        "flow_id": None,
        "started_at": None,
        "last_evaluated": None,
        "last_notified": None,
        "confirmed_at": None,
        "confirmed_by": None,
        "last_error": None,
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
