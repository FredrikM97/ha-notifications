"""Tests for the canonical configuration contract."""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from custom_components.ha_notifications import RuntimeData, async_save_config
from custom_components.ha_notifications.config_flow import HaNotificationsConfigFlow
from custom_components.ha_notifications.configuration import (
    AlertConfig,
    Configuration,
    ConfirmationConfig,
    ConfirmationNotificationConfig,
    NotificationConfig,
    TriggerOptions,
    validate_config,
)


def test_editor_defaults_match_shared_contract_and_are_independent() -> None:
    expected = json.loads((Path(__file__).parents[1] / "contracts" / "alert_defaults.json").read_text())
    first = AlertConfig.editor_defaults("alert_draft")
    second = AlertConfig.editor_defaults("alert_draft")

    assert first.model_dump(exclude_none=True) == expected
    assert second.model_dump(exclude_none=True) == expected
    assert validate_config({"alerts": [expected]})["alerts"][0] == expected

    first.monitor.triggers.items.append({"trigger": "event", "event_type": "changed"})
    first.monitor.conditions.interval = 60
    first.monitor.inactive.items.append({"trigger": "event", "event_type": "inactive"})
    first.notification.target["entity_id"] = ["notify.phone"]
    first.notification.options["push"] = {"sound": "default"}
    assert first.confirmation is not None
    first.confirmation.buttons[0].label = "Changed"
    first.confirmation.notification.options["color"] = "red"
    first.confirmation.reminders.interval = 60
    first.confirmation.actions.append({"action": "light.turn_on"})

    assert second.model_dump(exclude_none=True) == expected
    assert AlertConfig.editor_defaults("alert_draft").model_dump(exclude_none=True) == expected


def test_validate_config_minimal_alert_does_not_inherit_editor_overrides() -> None:
    alert = validate_config({"alerts": [{"id": "minimal", "notification": {}}]})["alerts"][0]

    assert "confirmation" not in alert
    assert "interval" not in alert["monitor"]["conditions"]


@pytest.mark.parametrize("reminders", [{}, {"enabled": True, "interval": 60, "max_attempts": 2}])
def test_validate_config_only_persists_explicit_interval_and_reminder_fields(reminders: dict) -> None:
    alert = validate_config({"alerts": [{
        "id": "minimal",
        "notification": {},
        "monitor": {"conditions": {"interval": 60}},
        "confirmation": {"reminders": reminders} if reminders else {},
    }]})["alerts"][0]

    assert alert["monitor"]["conditions"]["interval"] == 60
    assert alert["confirmation"]["reminders"] == reminders


@pytest.mark.parametrize("name", ["base", "confirmation", "notification", "configuration", "persisted", "full_feature"])
def test_shared_alert_fixtures_use_canonical_configuration(backend_alerts, name: str) -> None:
    raw = {"alerts": [backend_alerts[name]]}
    original = deepcopy(raw)
    validated = validate_config(raw)
    assert validate_config(validated) == validated
    assert raw == original


@pytest.mark.parametrize("model", [NotificationConfig, ConfirmationNotificationConfig])
@pytest.mark.parametrize("enabled", [None, True, False])
def test_notification_default_tag_is_metadata_with_a_deterministic_default(model, enabled) -> None:
    raw = {"options": {"tag": "custom", "native_extra": True}}
    if enabled is not None:
        raw["use_default_tag"] = enabled
    stored = model.model_validate(raw).model_dump(exclude_none=True)
    assert stored["use_default_tag"] is (True if enabled is None else enabled)
    assert stored["options"] == raw["options"]
    assert model.model_validate(stored).model_dump(exclude_none=True) == stored


@pytest.mark.parametrize("model", [NotificationConfig, ConfirmationNotificationConfig])
@pytest.mark.parametrize("invalid", ["false", 0, None, {}])
def test_notification_default_tag_requires_a_boolean(model, invalid) -> None:
    with pytest.raises(ValidationError, match="valid boolean"):
        model.model_validate({"use_default_tag": invalid})


@pytest.mark.parametrize("model", [NotificationConfig, ConfirmationNotificationConfig])
def test_notification_models_define_canonical_content_fields(model) -> None:
    assert {"title", "message", "options"} <= model.model_fields.keys()
    assert "data" not in model.model_fields


@pytest.mark.parametrize("confirmation", [False, True], ids=["main", "confirmation"])
@pytest.mark.parametrize("content", [{}, {"title": "Title only"}, {"message": ""}])
def test_validate_config_defaults_absent_content_and_preserves_explicit_empty_message(
    confirmation: bool, content: dict,
) -> None:
    notification = {"action": "notify.mobile_app_phone", **content}
    alert = {"id": "content_alert", "notification": {}}
    if confirmation:
        alert["confirmation"] = {"enabled": True, "notification": notification}
    else:
        alert["notification"] = notification

    validated = validate_config({"alerts": [alert]})["alerts"][0]
    stored = validated["confirmation"] if confirmation else validated

    assert stored["notification"]["message"] == content.get("message", "")
    assert stored["notification"]["title"] == content.get("title", "")
    assert stored["notification"]["options"] == {}


def test_validate_config_accepts_canonical_monitor_object() -> None:
    config = validate_config({"alerts": [{
        "id": "low_water",
        "monitor": {
            "triggers": {"items": [{"trigger": "state", "entity_id": "sensor.water"}]},
            "conditions": {"items": [{"condition": "state", "entity_id": "sensor.water", "state": "low"}]},
        },
        "notification": {
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.phone"]},
            "message": "Low water",
        },
    }]})
    alert = config["alerts"][0]
    assert config["version"] == 1
    assert alert["monitor"]["triggers"]["items"] == [{"trigger": "state", "entity_id": "sensor.water"}]
    assert alert["monitor"]["conditions"]["items"][0]["entity_id"] == "sensor.water"
    assert alert["notification"]["target"] == {"entity_id": ["notify.phone"]}
    assert alert["monitor"]["automation_mode"] == "parallel"
    assert "automation_mode" not in alert["monitor"]["triggers"]
    assert alert["monitor"]["inactive"] == {
        "enabled": False, "items": [], "clear_notification": False,
    }


@pytest.mark.parametrize("legacy_value", [False, True])
def test_validate_config_rejects_retired_cancel_on_inactive_without_mutating_input(
    legacy_value: bool,
) -> None:
    raw = {"alerts": [{
        "id": "quiet_alert",
        "monitor": {"cancel_on_inactive": legacy_value},
        "notification": {"action": "notify.mobile_app_phone"},
    }]}
    original = deepcopy(raw)
    with pytest.raises(ValidationError) as error:
        validate_config(raw)

    assert [(item["loc"], item["type"]) for item in error.value.errors()] == [
        (("alerts", 0, "monitor", "cancel_on_inactive"), "extra_forbidden"),
    ]
    assert raw == original


@pytest.mark.parametrize("unknown_field", ["cancel_on_inactive_typo", "clear_on_inactive", "unknown"])
def test_validate_config_rejects_unknown_monitor_fields(unknown_field: str) -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        validate_config({"alerts": [{
            "id": "quiet_alert",
            "monitor": {unknown_field: True},
            "notification": {"action": "notify.mobile_app_phone"},
        }]})


def test_validate_config_preserves_independent_trigger_and_condition_enablement() -> None:
    config = validate_config({"alerts": [{
        "id": "section_flags",
        "enabled": True,
        "monitor": {
            "triggers": {"enabled": False},
            "conditions": {"enabled": True},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }]})

    alert = config["alerts"][0]
    assert alert["enabled"] is True
    assert alert["monitor"]["triggers"]["enabled"] is False
    assert alert["monitor"]["conditions"]["enabled"] is True


def test_validate_config_rejects_persisted_mobile_options_groups() -> None:
    mobile_options = {
        "general": {"fields": {"color": {"enabled": False, "value": "#ff0000"}}},
        "android": {"enabled": False, "values": {"channel": "Alerts", "ttl": 0}},
        "ios": {"enabled": False, "values": {"push": {"sound": None}}},
    }
    raw = {"alerts": [{
        "id": "mobile_alert",
        "mobile_options": mobile_options,
        "notification": {
            "options": {"native_extra": {"priority": "high"}},
        },
    }]}
    original = deepcopy(raw)
    with pytest.raises(ValidationError, match="mobile_options"):
        validate_config(raw)
    assert raw == original


@pytest.mark.parametrize("confirmation", [False, True], ids=["main", "confirmation"])
@pytest.mark.parametrize("content_field", ["title", "message"])
def test_validate_config_preserves_native_notification_data_without_mutating_input(
    confirmation: bool, content_field: str,
) -> None:
    notification = {
        "action": "notify.mobile_app_phone",
        content_field: "Canonical content",
        "options": {content_field: "Native device content", "color": "#00ff00"},
    }
    alert = {"id": "content_alert", "notification": {}}
    if confirmation:
        alert["confirmation"] = {"enabled": True, "notification": notification}
    else:
        alert["notification"] = notification
    raw = {"alerts": [alert]}
    original = deepcopy(raw)

    validated = validate_config(raw)
    stored = validated["alerts"][0]
    if confirmation:
        stored = stored["confirmation"]
    assert stored["notification"]["options"] == notification["options"]
    assert stored["notification"][content_field] == "Canonical content"
    assert validate_config(validated) == validated
    assert raw == original


@pytest.mark.parametrize("confirmation", [False, True], ids=["main", "confirmation"])
@pytest.mark.parametrize("data", ["invalid", 1, False, ["invalid"]])
def test_validate_config_rejects_non_mapping_notification_options(
    confirmation: bool, data: Any,
) -> None:
    alert = {"id": "content_alert", "notification": {}}
    notification = {"options": data}
    if confirmation:
        alert["confirmation"] = {"notification": notification}
    else:
        alert["notification"] = notification

    with pytest.raises(ValidationError, match="valid dictionary"):
        validate_config({"alerts": [alert]})


@pytest.mark.parametrize("confirmation", [False, True], ids=["main", "confirmation"])
def test_validate_config_preserves_canonical_notification_content_and_native_extras(
    confirmation: bool,
) -> None:
    notification = {
        "action": "notify.mobile_app_phone",
        "title": "Canonical title",
        "message": "Canonical message",
        "options": {
            "color": "#00ff00", "subject": "Subject", "subtitle": "Subtitle",
            "push": {"sound": "default"},
            "template_message": "Opaque native metadata",
            "data": {"title": "Device-specific nested title"},
        },
    }
    alert = {"id": "content_alert", "notification": {}}
    if confirmation:
        alert["confirmation"] = {"enabled": True, "notification": notification}
    else:
        alert["notification"] = notification
    raw = {"alerts": [alert]}
    original = deepcopy(raw)

    validated = validate_config(raw)
    stored = validated["alerts"][0]
    if confirmation:
        stored = stored["confirmation"]
    assert all(stored["notification"][key] == value for key, value in notification.items())
    assert validate_config(validated) == validated
    assert raw == original


@pytest.mark.parametrize("confirmation", [False, True])
@pytest.mark.parametrize("retired", [
    {"data": {"title": "Old", "message": "Old", "data": {"color": "red"}}},
    {"editor_options": {"fields": {"mobile.color": {"enabled": True}}}},
    {"general": {"fields": {"color": {"enabled": True}}}},
])
def test_validate_config_rejects_retired_notification_shapes(confirmation, retired) -> None:
    alert = {"id": "water", "notification": {}}
    if confirmation:
        alert["confirmation"] = {"notification": retired}
    else:
        alert["notification"] = retired
    raw = {"alerts": [alert]}
    original = deepcopy(raw)
    with pytest.raises(ValidationError, match="Extra inputs"):
        validate_config(raw)
    assert raw == original


def test_validate_config_rejects_retired_condition_change_setting() -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{
            "id": "condition_alert",
            "on_condition_change": True,
            "notification": {"action": "notify.mobile_app_phone"},
        }]})


def test_validate_config_rejects_retired_clear_on_inactive_option() -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{
            "id": "legacy_alert",
            "clear_on_inactive": True,
            "notification": {"action": "notify.mobile_app_phone"},
        }]})


@pytest.mark.parametrize("mode", ["single", "restart", "queued", "parallel"])
def test_validate_config_accepts_automation_modes(mode: str) -> None:
    config = validate_config({"alerts": [{
        "id": "mode_alert",
        "monitor": {"automation_mode": mode},
        "notification": {"action": "notify.mobile_app_phone"},
    }]})

    assert config["alerts"][0]["monitor"]["automation_mode"] == mode


@pytest.mark.parametrize("legacy_mode", ["single", "restart", "queued", "parallel"])
@pytest.mark.parametrize("top_mode", [None, "queued"])
def test_validate_config_rejects_nested_mode_without_mutating_input(
    legacy_mode: str, top_mode: str | None,
) -> None:
    monitor = {
        "triggers": {"automation_mode": legacy_mode, "items": [{
            "trigger": "state", "entity_id": "binary_sensor.door", "id": "open",
        }]},
    }
    if top_mode is not None:
        monitor["automation_mode"] = top_mode
    raw = {"alerts": [{"id": "door", "monitor": monitor, "notification": {}}]}
    original = deepcopy(raw)

    with pytest.raises(ValidationError) as error:
        validate_config(raw)

    assert [(item["loc"], item["type"]) for item in error.value.errors()] == [
        (("alerts", 0, "monitor", "triggers", "automation_mode"), "extra_forbidden"),
    ]
    assert raw == original


def test_trigger_options_rejects_monitor_owned_mode() -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        TriggerOptions.model_validate({"automation_mode": "parallel"})


def test_validate_config_preserves_native_inactive_triggers() -> None:
    inactive = {
        "enabled": True,
        "items": [{
            "trigger": "state", "entity_id": ["binary_sensor.door"],
            "from": "on", "to": "off", "id": "door_closed",
            "for": {"seconds": "{{ hold_seconds }}"},
            "alias": "Door closed", "enabled": "{{ enabled }}",
        }],
        "clear_notification": True,
    }
    raw = {"alerts": [{"id": "door", "monitor": {"inactive": inactive}, "notification": {}}]}
    original = deepcopy(raw)

    config = validate_config(raw)

    assert config["alerts"][0]["monitor"]["inactive"] == inactive
    assert raw == original
    assert validate_config(config) == config


@pytest.mark.parametrize("items", [["not a mapping"], {}, None])
def test_validate_config_rejects_invalid_inactive_items(items: object) -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{
            "id": "door", "monitor": {"inactive": {"items": items}}, "notification": {},
        }]})


def test_validate_config_rejects_unknown_automation_mode() -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{
            "id": "mode_alert",
            "monitor": {"automation_mode": "restart_and_parallel"},
            "notification": {"action": "notify.mobile_app_phone"},
        }]})


def test_validate_config_rejects_legacy_shape() -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{
            "id": "low_water",
            "evaluate": {"startup": True},
            "condition": {"condition": "state"},
            "notification": {"action": "notify.mobile_app_phone"},
        }]})


def test_validate_config_rejects_invalid_alert_id_and_duplicate_ids() -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{"id": "Bad-ID", "notification": {}}]})
    alert = {"id": "low_water", "notification": {"action": "notify.mobile_app_phone"}}
    with pytest.raises(ValidationError, match="alert IDs must be unique"):
        validate_config({"alerts": [alert, {**alert}]})


def test_validate_config_rejects_invalid_notification_action() -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{"id": "low_water", "notification": {"action": "notify"}}]})


def test_validate_config_rejects_invalid_trigger_entries() -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{
            "id": "low_water",
            "monitor": {"triggers": {"items": ["not a mapping"]}},
            "notification": {"action": "notify.mobile_app_phone"},
        }]})


def test_validate_config_accepts_confirmation_and_post_send_actions() -> None:
    config = validate_config({"alerts": [{
        "id": "confirm_alert",
        "monitor": {"conditions": {"startup": True}},
        "notification": {"action": "notify.mobile_app_phone"},
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "reminders": {"enabled": True, "interval": 15, "max_attempts": 3},
            "follow_up": {"actions": [{"action": "light.turn_on"}]},
        },
        "post_send_actions": {"enabled": True, "actions": [{"action": "logbook.log"}]},
    }]})
    alert = config["alerts"][0]
    assert alert["confirmation"]["buttons"][0]["id"] == "confirm"
    assert alert["post_send_actions"]["actions"][0]["action"] == "logbook.log"


@pytest.mark.parametrize("actions", [{}, {"items": []}, {
    "enabled": True,
    "items": [{"action": "light.turn_on", "target": {"entity_id": "light.hall"}}],
}])
def test_validate_config_rejects_confirmation_actions_wrapper_without_mutating_input(
    alert_factory, actions: dict[str, object],
) -> None:
    raw = {"alerts": [alert_factory(confirmation={"enabled": True, "actions": actions})]}
    original = deepcopy(raw)

    with pytest.raises(ValidationError) as error:
        validate_config(raw)

    assert [(item["loc"], item["type"]) for item in error.value.errors()] == [
        (("alerts", 0, "confirmation", "actions"), "list_type"),
    ]
    assert raw == original


def test_confirmation_actions_default_to_independent_empty_lists() -> None:
    confirmation = ConfirmationConfig()
    other_confirmation = ConfirmationConfig()

    assert confirmation.actions == []
    assert confirmation.actions is not other_confirmation.actions


def test_validate_config_preserves_native_confirmation_action_list(alert_factory) -> None:
    actions = [{
        "action": "light.turn_on",
        "alias": "Turn on the hall light",
        "enabled": "{{ lights_enabled }}",
        "continue_on_error": True,
        "target": {"entity_id": ["light.hall"], "area_id": "hall"},
        "data": {"brightness": "{{ brightness }}", "transition": 2},
    }, {
        "choose": [{
            "conditions": "{{ notify_again }}",
            "sequence": [{"action": "logbook.log", "data": {"message": "Confirmed"}}],
        }],
        "default": [{"delay": {"seconds": "{{ delay_seconds }}"}}],
    }]
    raw = {"alerts": [alert_factory(confirmation={"enabled": True, "actions": actions})]}
    original = deepcopy(raw)

    validated = validate_config(raw)
    confirmation = Configuration.model_validate(validated).alerts[0].confirmation

    assert confirmation is not None
    assert confirmation.actions == actions
    assert validated["alerts"][0]["confirmation"]["actions"] == actions
    assert validate_config(validated) == validated
    assert raw == original


def test_validate_config_preserves_confirmation_notification_opt_out() -> None:
    config = validate_config({"alerts": [{
        "id": "confirm_alert",
        "notification": {"action": "notify.mobile_app_phone"},
        "confirmation": {
            "enabled": True,
            "notification": {
                "enabled": False,
                "action": "notify.mobile_app_phone",
                "message": "Confirmed",
            },
        },
    }]})

    assert config["alerts"][0]["confirmation"]["notification"] == {
        "enabled": False,
        "action": "notify.mobile_app_phone",
        "title": "",
        "message": "Confirmed",
        "use_default_tag": True,
        "options": {},
    }


def test_validate_config_rejects_nonpositive_confirmation_attempts() -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{
            "id": "confirm_alert",
            "monitor": {"conditions": {"startup": True}},
            "notification": {"action": "notify.mobile_app_phone"},
            "confirmation": {
                "enabled": True,
                "reminders": {"enabled": True, "max_attempts": 0},
            },
        }]})


@pytest.mark.parametrize(
    "timeout",
    [0, "0", "00:00", "00:00:00", {"seconds": 0}],
)
def test_validate_config_rejects_zero_forget_after_timeout(timeout: object) -> None:
    with pytest.raises(ValidationError, match="requires a positive reminders.timeout"):
        validate_config({"alerts": [{
            "id": "confirm_alert",
            "notification": {"action": "notify.mobile_app_phone"},
            "confirmation": {
                "enabled": True,
                "reminders": {
                    "forget_after_enabled": True,
                    "timeout": timeout,
                },
            },
        }]})


def test_validate_config_keeps_zero_timeout_when_forget_after_is_disabled() -> None:
    config = validate_config({"alerts": [{
        "id": "confirm_alert",
        "notification": {"action": "notify.mobile_app_phone"},
        "confirmation": {
            "enabled": True,
            "reminders": {
                "forget_after_enabled": False,
                "timeout": 0,
            },
        },
    }]})

    assert config["alerts"][0]["confirmation"]["reminders"]["timeout"] == 0


def test_configuration_preserves_native_extensions_on_canonical_models() -> None:
    raw = {
        "alerts": [{
            "id": "extended_alert",
            "notification": {
                "action": "notify.mobile_app_phone",
                "options": {"notification_native": {"priority": "high"}},
            },
            "confirmation": {
                "enabled": True,
                "buttons": [{
                    "id": "confirm",
                    "label": "Confirm",
                    "button_native": "value",
                }],
                "notification": {
                    "action": "notify.mobile_app_phone",
                    "options": {"confirmation_native": {"channel": "alerts"}},
                },
                "reminders": {
                    "enabled": True,
                    "reminder_native": True,
                },
                "confirmation_native": "value",
            },
        }]}

    alert = Configuration.model_validate(raw).alerts[0]

    assert alert.notification.options == {
        "notification_native": {"priority": "high"},
    }
    assert alert.confirmation is not None
    assert alert.confirmation.buttons[0].__pydantic_extra__ == {
        "button_native": "value",
    }
    assert alert.confirmation.notification.options == {
        "confirmation_native": {"channel": "alerts"},
    }
    assert alert.confirmation.reminders.__pydantic_extra__ == {
        "reminder_native": True,
    }
    assert alert.confirmation.__pydantic_extra__ == {
        "confirmation_native": "value",
    }


def test_full_feature_configuration_preserves_confirmation_and_post_send_actions(
    full_feature_alert: dict[str, object],
) -> None:
    validated = validate_config({"alerts": [full_feature_alert]})
    alert = Configuration.model_validate(validated).alerts[0]

    assert alert.model_dump(mode="python", exclude_none=True) == validated["alerts"][0]
    assert alert.confirmation is not None
    assert alert.confirmation.actions == [{
        "action": "light.turn_on",
        "target": {"entity_id": "light.hall"},
    }]
    assert alert.post_send_actions is not None
    assert alert.post_send_actions["actions"] == [{
        "action": "logbook.log",
        "data": {"name": "Full feature sent"},
    }]


@pytest.mark.asyncio
async def test_config_flow_creates_empty_canonical_document() -> None:
    result = await HaNotificationsConfigFlow().async_step_user({})
    assert result["type"] == "create_entry"
    assert result["data"] == {"version": 1, "alerts": []}


@pytest.mark.asyncio
async def test_async_save_config_rejects_invalid_data_before_entry_update() -> None:
    updates: list[dict[str, object]] = []

    class ConfigEntries:
        def async_update_entry(self, entry: object, **kwargs: object) -> None:
            updates.append(kwargs)

    class Hass:
        config_entries = ConfigEntries()
        data: dict[str, object] = {}

    class Entry:
        options: dict[str, object] = {}
        data: dict[str, object] = {"version": 1, "alerts": []}

    with pytest.raises(ValidationError):
        await async_save_config(Hass(), Entry(), {"version": 1, "alerts": [{"id": "Bad-ID"}]})
    assert updates == []


@pytest.mark.asyncio
async def test_async_save_config_updates_entry_runtime_data(tmp_path) -> None:
    updates: list[dict[str, object]] = []
    service_calls: list[tuple[object, ...]] = []

    class ConfigEntries:
        def async_update_entry(self, entry: object, **kwargs: object) -> None:
            updates.append(kwargs)

    class Hass:
        config_entries = ConfigEntries()

        def __init__(self) -> None:
            self.config = type("Config", (), {"path": lambda _, name: str(tmp_path / name)})()
            self.services = type("Services", (), {"async_call": self.async_call})()

        async def async_call(self, *args: object, **kwargs: object) -> None:
            service_calls.append(args)
            return None

        async def async_add_executor_job(self, function, *args: object) -> object:
            return function(*args)

    class Entry:
        options: dict[str, object] = {}
        data: dict[str, object] = {"version": 1, "alerts": []}

    hass = Hass()
    entry = Entry()
    saved = await async_save_config(hass, entry, {"version": 1, "alerts": []})
    assert isinstance(entry.runtime_data, RuntimeData)
    assert entry.runtime_data.config == saved
    assert updates == [{"options": saved}]
    assert service_calls == [("automation", "reload")]
