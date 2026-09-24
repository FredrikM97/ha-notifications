"""Tests for direct Pydantic configuration and feature models."""

from __future__ import annotations

from custom_components.ha_notifications.domain.runtime import (
    AlertRuntimeState,
    serialize_runtime,
)
from custom_components.ha_notifications.features.confirmations import (
    ConfirmationConfig,
)
from custom_components.ha_notifications.features.notification import (
    NotificationConfig,
)
from tests.backend.conftest import alert_fixture
from tests.backend.support.test_support import load_const_and_models

_, models = load_const_and_models()


def test_configuration_model_contract_snapshot(snapshot):
    alert = alert_fixture("configuration")
    configuration = models.Configuration.model_validate(
        {
            "alerts": [alert]
        }
    )

    assert configuration.model_dump(exclude_none=True) == snapshot


def test_runtime_writes_complete_independent_state():
    runtime = AlertRuntimeState.for_alert({"id": "one"})
    target = {"stale": True}

    target = serialize_runtime(runtime)
    runtime.config["name"] = "Changed"

    assert "stale" not in target
    assert "name" not in target["config"]

def test_alert_owns_feature_sections_as_extra_fields():
    assert set(models.Alert.model_fields) == {
        "id",
        "name",
        "enabled",
        "description",
        "icon",
        "created_at",
        "updated_at",
        "monitor",
    }

def test_alert_preserves_supplied_fields():
    alert = models.Alert.model_validate(
        {
            "id": "kitchen_lights",
            "name": "Kitchen lights",
            "logic": "any",
            "notifications": [{"action": "notify.legacy"}],
            "notification": {},
            "confirmation": {
                "enabled": True,
                "buttons": [{"id": "confirm", "label": "Done"}],
            },
        }
    )
    mapped = alert.model_dump(exclude_none=True)
    assert alert.id == "kitchen_lights"
    assert alert.model_extra["logic"] == "any"
    assert "notifications" in mapped
    assert alert.confirmation["enabled"]

def test_alert_entity_exposes_feature_fields_without_projection():
    alert = models.Alert.model_validate(
        {"id": "one", "name": "One", "notification": {"message": "Hi"}}
    )
    assert alert["id"] == "one"
    assert alert["notification"]["message"] == "Hi"
    assert dict(alert)["name"] == "One"

def test_configuration_accepts_supplied_alert_list():
    config = models.Configuration.model_validate(
        {
            "alerts": [
                {"id": "one", "name": "One"},
                {"id": "two", "name": "Two"},
            ],
        }
    )
    assert config.version == 1
    assert [alert.name for alert in config.alerts] == ["One", "Two"]
    assert "notification" not in config.alerts[0].model_extra

def test_feature_models_are_mutable_typed_objects():
    confirmation = ConfirmationConfig.model_validate(
        {"buttons": [{"id": "confirm", "label": "Acknowledge"}]}
    )
    notification = NotificationConfig.model_validate({})
    confirmation.buttons[0].label = "Done"
    assert confirmation.buttons[0].label == "Done"
    assert notification.model_dump(exclude_none=True) == {}
