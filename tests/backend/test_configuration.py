"""Tests for the canonical configuration contract."""

import asyncio
import json
from copy import deepcopy
from pathlib import Path
from typing import Any, ClassVar

import pytest
from pydantic import ValidationError

from custom_components.ha_notifications import RuntimeData, async_save_config
from custom_components.ha_notifications.configuration import (
    AlertConfig,
    ConditionOptions,
    Configuration,
    ConfirmationButtonConfig,
    ConfirmationConfig,
    ConfirmationNotificationConfig,
    IntervalConfig,
    MonitorConfig,
    NotificationConfig,
    ReminderConfig,
    find_alert,
    upsert_alert,
    validate_config,
)


def test_feature_model_defaults_match_shared_contract_and_are_independent() -> None:
    expected = json.loads(
        (Path(__file__).parents[1] / "contracts" / "alert_defaults.json").read_text()
    )
    assert validate_config({"alerts": [expected]})["alerts"][0] == expected
    first = AlertConfig(
        id="alert_draft", notification=NotificationConfig(), confirmation=ConfirmationConfig()
    )
    second = AlertConfig(
        id="alert_draft", notification=NotificationConfig(), confirmation=ConfirmationConfig()
    )

    assert first.model_dump(exclude_none=True) == expected
    assert second.model_dump(exclude_none=True) == expected
    assert validate_config({"alerts": [expected]})["alerts"][0] == expected

    first.monitor.triggers.items.append({"trigger": "event", "event_type": "changed"})
    first.monitor.conditions.items.append({"condition": "template", "value_template": "{{ true }}"})
    first.monitor.conditions.interval.enabled = True
    first.monitor.conditions.interval.value = 60
    first.monitor.inactive.items.append({"trigger": "event", "event_type": "inactive"})
    first.notification.target["entity_id"] = ["notify.phone"]
    first.notification.options["push"] = {"sound": "default"}
    assert first.confirmation is not None
    first.confirmation.buttons.append(ConfirmationButtonConfig(id="custom", label="Changed"))
    first.confirmation.notification.options["color"] = "red"
    first.confirmation.reminders.interval = 60
    first.confirmation.reminders.forget_after.value = 60
    first.confirmation.actions.items.append({"action": "light.turn_on"})

    assert second.model_dump(exclude_none=True) == expected
    assert (
        AlertConfig(
            id="alert_draft",
            notification=NotificationConfig(),
            confirmation=ConfirmationConfig(),
        ).model_dump(exclude_none=True)
        == expected
    )


def test_validate_config_minimal_alert_defaults_confirmation_and_interval() -> None:
    alert = validate_config({"alerts": [{"id": "minimal", "notification": {}}]})["alerts"][0]

    assert alert["confirmation"]["buttons"] == [{"id": "confirm", "label": "Done"}]
    assert alert["monitor"]["conditions"]["interval"] == {"enabled": False, "value": 43200}


def test_alert_requires_id_and_defaults_notification_and_confirmation() -> None:
    with pytest.raises(ValidationError, match="id"):
        AlertConfig()
    alert = AlertConfig(id="minimal")
    assert alert.notification.model_dump(exclude_none=True) == NotificationConfig().model_dump(
        exclude_none=True
    )
    assert alert.confirmation.model_dump()["buttons"] == [
        {"id": "confirm", "label": "Done"},
    ]
    assert alert.model_dump(exclude_none=True)["confirmation"]["buttons"] == [
        {"id": "confirm", "label": "Done"},
    ]


def test_reminder_model_serializes_declared_defaults() -> None:
    reminders = ReminderConfig()
    assert reminders.model_dump() == {
        "enabled": True,
        "interval": 1800,
        "max_attempts": 5,
        "show_attempts": False,
        "forget_after": {"enabled": False, "value": 900},
    }
    assert "forget_after_enabled" not in ReminderConfig.model_fields
    assert ReminderConfig.model_validate(reminders.model_dump()) == reminders


def test_reminder_model_preserves_explicit_values_and_native_extensions() -> None:
    raw = {
        "enabled": False,
        "interval": {"minutes": 2},
        "max_attempts": 2,
        "show_attempts": True,
        "forget_after": {"enabled": True, "value": 60},
        "native_extra": {"value": "preserved"},
    }
    reminders = ReminderConfig.model_validate(raw)
    assert reminders.model_dump() == raw
    assert ReminderConfig.model_validate(reminders.model_dump()) == reminders


def test_condition_interval_defaults_to_nested_model() -> None:
    conditions = ConditionOptions()
    assert isinstance(conditions.interval, IntervalConfig)
    assert conditions.interval.model_dump() == {"enabled": False, "value": 43200}
    assert "periodic" not in ConditionOptions.model_fields
    assert ConditionOptions.model_validate({"interval": {}}) == conditions


@pytest.mark.parametrize(
    "interval",
    [
        60,
        0.5,
        "300",
        "05:00",
        "00:05:00",
        {"minutes": 5},
        {"days": 1, "hours": 2, "minutes": 3, "seconds": 0.5},
    ],
)
@pytest.mark.parametrize("enabled", [False, True])
def test_condition_interval_defaults_and_preserves_explicit_values(
    interval: object,
    enabled: bool,
) -> None:
    raw = {"interval": {"enabled": enabled, "value": interval}}
    original = deepcopy(raw)
    conditions = ConditionOptions.model_validate(raw)
    assert conditions.model_dump()["interval"] == raw["interval"]
    assert ConditionOptions.model_validate(conditions.model_dump()) == conditions
    assert raw == original


def test_disabled_condition_interval_retains_value_without_scheduling() -> None:
    raw = {
        "alerts": [
            {
                "id": "disabled_interval",
                "notification": {},
                "monitor": {
                    "conditions": {"interval": {"enabled": False, "value": {"minutes": 5}}}
                },
            }
        ]
    }
    original = deepcopy(raw)
    stored = validate_config(raw)["alerts"][0]
    assert stored["monitor"]["conditions"]["interval"] == {
        "enabled": False,
        "value": {"minutes": 5},
    }
    assert AlertConfig.model_validate(stored).monitor.enabled_triggers == []
    assert raw == original


@pytest.mark.parametrize("conditions_enabled", [False, True])
def test_condition_interval_schedule_requires_parent_conditions_enabled(
    conditions_enabled: bool,
) -> None:
    monitor = MonitorConfig.model_validate(
        {
            "conditions": {
                "enabled": conditions_enabled,
                "interval": {"enabled": True, "value": {"minutes": 5}},
            }
        }
    )
    assert monitor.enabled_triggers == (
        [{"trigger": "time_pattern", "minutes": "/5"}] if conditions_enabled else []
    )
    assert monitor.conditions.interval.model_dump() == {"enabled": True, "value": {"minutes": 5}}


@pytest.mark.parametrize("invalid", ["false", 0, 1, None, {}])
def test_condition_interval_enabled_requires_strict_boolean(invalid: object) -> None:
    with pytest.raises(ValidationError, match="valid boolean"):
        ConditionOptions.model_validate({"interval": {"enabled": invalid}})


@pytest.mark.parametrize("periodic", [False, True])
def test_condition_periodic_field_is_rejected_without_mutation(periodic: bool) -> None:
    raw = {
        "alerts": [
            {
                "id": "periodic_alert",
                "notification": {},
                "monitor": {"conditions": {"periodic": periodic}},
            }
        ]
    }
    original = deepcopy(raw)
    with pytest.raises(ValidationError, match="periodic"):
        validate_config(raw)
    assert raw == original


@pytest.mark.parametrize("interval", [60, 0.5, "00:05:00", {"minutes": 5}, None])
def test_condition_interval_value_without_enablement_is_rejected_without_mutation(
    interval: object,
) -> None:
    raw = {
        "alerts": [
            {
                "id": "interval_alert",
                "notification": {},
                "monitor": {"conditions": {"interval": interval}},
            }
        ]
    }
    original = deepcopy(raw)
    with pytest.raises(ValidationError, match="interval"):
        validate_config(raw)
    assert raw == original


@pytest.mark.parametrize("interval", [{"value": None}, {"unknown": True}])
def test_condition_interval_rejects_null_value_and_extra_fields(interval: dict) -> None:
    with pytest.raises(ValidationError):
        ConditionOptions.model_validate({"interval": interval})


@pytest.mark.parametrize("buttons", [[], [{"id": "skip", "label": "Skip", "native_extra": True}]])
def test_confirmation_buttons_preserve_explicit_values(buttons: list[dict]) -> None:
    assert ConfirmationConfig().model_dump()["buttons"] == [{"id": "confirm", "label": "Done"}]
    assert (
        ConfirmationConfig.model_validate({"buttons": buttons}).model_dump()["buttons"] == buttons
    )


def test_missing_confirmation_buttons_use_the_shared_default() -> None:
    alert = validate_config(
        {
            "alerts": [
                {
                    "id": "minimal",
                    "notification": {},
                    "confirmation": {"enabled": True},
                }
            ]
        }
    )["alerts"][0]
    assert alert["confirmation"]["buttons"] == [{"id": "confirm", "label": "Done"}]


@pytest.mark.parametrize("reminders", [{}, {"enabled": True, "interval": 60, "max_attempts": 2}])
@pytest.mark.parametrize(
    "conditions",
    [
        {},
        {"interval": {}},
        {"interval": {"value": 60}},
        {"interval": {"enabled": True}},
        {"interval": {"enabled": True, "value": 60}},
    ],
)
def test_validate_config_expands_model_owned_interval_and_reminder_defaults(
    reminders: dict,
    conditions: dict,
) -> None:
    raw = {
        "alerts": [
            {
                "id": "minimal",
                "notification": {},
                "monitor": {"conditions": conditions},
                "confirmation": {"reminders": reminders},
            }
        ]
    }
    original = deepcopy(raw)
    validated = validate_config(raw)
    alert = validated["alerts"][0]

    assert alert["monitor"]["conditions"]["interval"] == {
        "enabled": False,
        "value": 43200,
        **conditions.get("interval", {}),
    }
    assert alert["confirmation"]["reminders"] == {
        "enabled": True,
        "interval": 1800,
        "max_attempts": 5,
        "show_attempts": False,
        "forget_after": {"enabled": False, "value": 900},
        **reminders,
    }
    assert validate_config(validated) == validated
    assert raw == original


@pytest.mark.parametrize(
    "name", ["base", "confirmation", "notification", "configuration", "persisted", "full_feature"]
)
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


def test_shared_option_controls_contract(option_controls_contract) -> None:
    original = deepcopy(option_controls_contract["notification"])
    notification = NotificationConfig.model_validate(original)
    assert notification.delivery_options() == option_controls_contract["delivery_options"]
    assert notification.model_dump(exclude_none=True) == original


@pytest.mark.parametrize("confirmation", [False, True], ids=["main", "confirmation"])
def test_validate_config_retains_notification_option_controls_and_disabled_values(
    confirmation: bool,
) -> None:
    notification = {
        "options": {
            "channel": "Saved channel",
            "ttl": 0,
            "sticky": False,
            "push": {"sound": "saved.aiff", "custom": {"values": [False, 0]}},
        },
        "option_controls": {
            "mobile": {"enabled": True, "fields": {"sticky": True}},
            "android": {"enabled": False, "fields": {"channel": True, "ttl": False}},
            "ios": {"enabled": True, "fields": {"push.sound": False}},
        },
    }
    alert = {"id": "option_controls", "notification": {}}
    if confirmation:
        alert["confirmation"] = {"notification": notification}
    else:
        alert["notification"] = notification
    raw = {"alerts": [alert]}
    original = deepcopy(raw)

    validated = validate_config(raw)
    stored = validated["alerts"][0]
    if confirmation:
        stored = stored["confirmation"]
    assert stored["notification"]["options"] == notification["options"]
    assert stored["notification"]["option_controls"] == notification["option_controls"]
    assert validate_config(validated) == validated
    assert raw == original


@pytest.mark.parametrize("model", [NotificationConfig, ConfirmationNotificationConfig])
@pytest.mark.parametrize("group", ["mobile", "android", "ios"])
@pytest.mark.parametrize(
    ("group_enabled", "field_enabled"),
    [(True, True), (True, False), (False, True), (False, False)],
)
def test_notification_delivery_options_filters_only_declared_disabled_paths(
    model,
    group: str,
    group_enabled: bool,
    field_enabled: bool,
) -> None:
    raw = {
        "options": {
            "channel": "Saved channel",
            "ttl": 0,
            "sticky": False,
            "push": {"sound": "saved.aiff", "custom": {"values": [False, 0]}},
            "native_empty": {},
        },
        "option_controls": {
            group: {"enabled": group_enabled, "fields": {"push.sound": field_enabled}},
        },
    }
    original = deepcopy(raw)
    notification = model.model_validate(raw)
    stored = notification.model_dump(exclude_none=True)
    expected = deepcopy(raw["options"])
    if not group_enabled or not field_enabled:
        del expected["push"]["sound"]

    delivered = notification.delivery_options()
    assert delivered == expected
    assert delivered["ttl"] == 0
    assert delivered["sticky"] is False
    delivered["push"]["custom"]["values"].append("changed")
    assert notification.model_dump(exclude_none=True) == stored
    assert raw == original


@pytest.mark.parametrize("model", [NotificationConfig, ConfirmationNotificationConfig])
@pytest.mark.parametrize("value", [False, 0])
def test_notification_delivery_options_preserves_enabled_false_and_zero(model, value) -> None:
    notification = model.model_validate(
        {
            "options": {"native_extension": value, "push": {"custom": value}},
            "option_controls": {
                "mobile": {"fields": {"native_extension": True, "push.custom": True}},
            },
        }
    )
    delivered = notification.delivery_options()
    assert delivered == {"native_extension": value, "push": {"custom": value}}
    assert type(delivered["native_extension"]) is type(value)
    assert type(delivered["push"]["custom"]) is type(value)


@pytest.mark.parametrize("controls", [None, {}, {"ios": {"enabled": False, "fields": {}}}])
def test_notification_delivery_options_without_declared_paths_is_a_deep_copy(controls) -> None:
    notification = NotificationConfig.model_validate(
        {
            "options": {"push": {"sound": "default", "custom": [False, 0]}, "empty": {}},
            "option_controls": controls,
        }
    )
    stored = notification.model_dump(exclude_none=True)
    if controls is None:
        assert "option_controls" not in stored
    delivered = notification.delivery_options()
    assert delivered == notification.options
    delivered["push"]["custom"].append("changed")
    assert notification.model_dump(exclude_none=True) == stored


@pytest.mark.parametrize(
    ("options", "paths", "expected"),
    [
        ({"push": {"sound": "default"}}, ["push.sound"], {}),
        ({"push": {"sound": {"name": "default"}}}, ["push.sound.name"], {}),
        ({"push": {"sound": "default", "custom": {}}}, ["push.sound"], {"push": {"custom": {}}}),
        ({"push": {}}, ["push.sound"], {"push": {}}),
        ({"push": "native"}, ["push.sound"], {"push": "native"}),
        ({"push": {"sound": "default"}}, ["missing.sound"], {"push": {"sound": "default"}}),
        ({"push": {"sound": "default", "badge": 0}}, ["push.sound", "push.badge"], {}),
    ],
)
def test_notification_delivery_options_prunes_only_ancestors_of_removed_paths(
    options: dict,
    paths: list[str],
    expected: dict,
) -> None:
    notification = NotificationConfig.model_validate(
        {
            "options": options,
            "option_controls": {"ios": {"fields": dict.fromkeys(paths, False)}},
        }
    )
    original = deepcopy(options)
    assert notification.delivery_options() == expected
    assert notification.options == original
    assert options == original


@pytest.mark.parametrize("model", [NotificationConfig, ConfirmationNotificationConfig])
@pytest.mark.parametrize("invalid", ["false", 0, 1, None, {}])
@pytest.mark.parametrize("control_field", ["enabled", "fields"])
def test_notification_option_controls_require_strict_booleans(
    model,
    invalid,
    control_field: str,
) -> None:
    control = {control_field: {"push.sound": invalid} if control_field == "fields" else invalid}
    with pytest.raises(ValidationError, match="valid boolean"):
        model.model_validate({"option_controls": {"ios": control}})


@pytest.mark.parametrize(
    "controls",
    [{"general": {"fields": {}}}, {"mobile": {"unknown": True}}],
)
def test_notification_option_controls_reject_unknown_groups_and_control_fields(controls) -> None:
    with pytest.raises(ValidationError):
        NotificationConfig.model_validate({"option_controls": controls})


@pytest.mark.parametrize("confirmation", [False, True], ids=["main", "confirmation"])
@pytest.mark.parametrize("content", [{}, {"title": "Title only"}, {"message": ""}])
def test_validate_config_defaults_absent_content_and_preserves_explicit_empty_message(
    confirmation: bool,
    content: dict,
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
    config = validate_config(
        {
            "alerts": [
                {
                    "id": "low_water",
                    "monitor": {
                        "triggers": {"items": [{"trigger": "state", "entity_id": "sensor.water"}]},
                        "conditions": {
                            "items": [
                                {"condition": "state", "entity_id": "sensor.water", "state": "low"}
                            ]
                        },
                    },
                    "notification": {
                        "action": "notify.mobile_app_phone",
                        "target": {"entity_id": ["notify.phone"]},
                        "message": "Low water",
                    },
                }
            ]
        }
    )
    alert = config["alerts"][0]
    assert config["version"] == 1
    assert alert["monitor"]["triggers"]["items"] == [
        {"trigger": "state", "entity_id": "sensor.water"}
    ]
    assert alert["monitor"]["conditions"]["items"][0]["entity_id"] == "sensor.water"
    assert alert["notification"]["target"] == {"entity_id": ["notify.phone"]}
    assert alert["monitor"]["inactive"] == {
        "enabled": False,
        "items": [],
        "clear_notification": False,
    }


@pytest.mark.parametrize("removed_value", [False, True])
def test_validate_config_rejects_retired_cancel_on_inactive_without_mutating_input(
    removed_value: bool,
) -> None:
    raw = {
        "alerts": [
            {
                "id": "quiet_alert",
                "monitor": {"cancel_on_inactive": removed_value},
                "notification": {"action": "notify.mobile_app_phone"},
            }
        ]
    }
    original = deepcopy(raw)
    with pytest.raises(ValidationError) as error:
        validate_config(raw)

    assert [(item["loc"], item["type"]) for item in error.value.errors()] == [
        (("alerts", 0, "monitor", "cancel_on_inactive"), "extra_forbidden"),
    ]
    assert raw == original


@pytest.mark.parametrize(
    "unknown_field", ["cancel_on_inactive_typo", "clear_on_inactive", "unknown"]
)
def test_validate_config_rejects_unknown_monitor_fields(unknown_field: str) -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        validate_config(
            {
                "alerts": [
                    {
                        "id": "quiet_alert",
                        "monitor": {unknown_field: True},
                        "notification": {"action": "notify.mobile_app_phone"},
                    }
                ]
            }
        )


def test_validate_config_preserves_independent_trigger_and_condition_enablement() -> None:
    config = validate_config(
        {
            "alerts": [
                {
                    "id": "section_flags",
                    "enabled": True,
                    "monitor": {
                        "triggers": {"enabled": False},
                        "conditions": {"enabled": True},
                    },
                    "notification": {"action": "notify.mobile_app_phone"},
                }
            ]
        }
    )

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
    raw = {
        "alerts": [
            {
                "id": "mobile_alert",
                "mobile_options": mobile_options,
                "notification": {
                    "options": {"native_extra": {"priority": "high"}},
                },
            }
        ]
    }
    original = deepcopy(raw)
    with pytest.raises(ValidationError, match="mobile_options"):
        validate_config(raw)
    assert raw == original


@pytest.mark.parametrize("confirmation", [False, True], ids=["main", "confirmation"])
@pytest.mark.parametrize("content_field", ["title", "message"])
def test_validate_config_preserves_native_notification_data_without_mutating_input(
    confirmation: bool,
    content_field: str,
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
    confirmation: bool,
    data: Any,
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
            "color": "#00ff00",
            "subject": "Subject",
            "subtitle": "Subtitle",
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
@pytest.mark.parametrize(
    "retired",
    [
        {"data": {"title": "Old", "message": "Old", "data": {"color": "red"}}},
        {"editor_options": {"fields": {"mobile.color": {"enabled": True}}}},
        {"general": {"fields": {"color": {"enabled": True}}}},
    ],
)
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
        validate_config(
            {
                "alerts": [
                    {
                        "id": "condition_alert",
                        "on_condition_change": True,
                        "notification": {"action": "notify.mobile_app_phone"},
                    }
                ]
            }
        )


def test_validate_config_rejects_retired_clear_on_inactive_option() -> None:
    with pytest.raises(ValidationError):
        validate_config(
            {
                "alerts": [
                    {
                        "id": "clearing_alert",
                        "clear_on_inactive": True,
                        "notification": {"action": "notify.mobile_app_phone"},
                    }
                ]
            }
        )


def test_validate_config_preserves_native_inactive_triggers() -> None:
    inactive = {
        "enabled": True,
        "items": [
            {
                "trigger": "state",
                "entity_id": ["binary_sensor.door"],
                "from": "on",
                "to": "off",
                "id": "door_closed",
                "for": {"seconds": "{{ hold_seconds }}"},
                "alias": "Door closed",
                "enabled": "{{ enabled }}",
            }
        ],
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
        validate_config(
            {
                "alerts": [
                    {
                        "id": "door",
                        "monitor": {"inactive": {"items": items}},
                        "notification": {},
                    }
                ]
            }
        )


def test_validate_config_rejects_removed_schema_fields() -> None:
    with pytest.raises(ValidationError):
        validate_config(
            {
                "alerts": [
                    {
                        "id": "low_water",
                        "evaluate": {"startup": True},
                        "condition": {"condition": "state"},
                        "notification": {"action": "notify.mobile_app_phone"},
                    }
                ]
            }
        )


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
        validate_config(
            {
                "alerts": [
                    {
                        "id": "low_water",
                        "monitor": {"triggers": {"items": ["not a mapping"]}},
                        "notification": {"action": "notify.mobile_app_phone"},
                    }
                ]
            }
        )


def test_validate_config_accepts_confirmation_and_post_send_actions() -> None:
    config = validate_config(
        {
            "alerts": [
                {
                    "id": "confirm_alert",
                    "monitor": {"conditions": {"startup": True}},
                    "notification": {"action": "notify.mobile_app_phone"},
                    "confirmation": {
                        "enabled": True,
                        "buttons": [{"id": "confirm", "label": "Confirm"}],
                        "reminders": {"enabled": True, "interval": 15, "max_attempts": 3},
                        "follow_up": {"actions": [{"action": "light.turn_on"}]},
                    },
                    "post_send_actions": {"enabled": True, "items": [{"action": "logbook.log"}]},
                }
            ]
        }
    )
    alert = config["alerts"][0]
    assert alert["confirmation"]["buttons"][0]["id"] == "confirm"
    assert alert["post_send_actions"]["items"][0]["action"] == "logbook.log"


@pytest.mark.parametrize("actions", [[], [{"action": "light.turn_on"}]])
def test_validate_config_rejects_flat_confirmation_action_list_without_mutating_input(
    alert_factory,
    actions: list[object],
) -> None:
    raw = {"alerts": [alert_factory(confirmation={"enabled": True, "actions": actions})]}
    original = deepcopy(raw)

    with pytest.raises(ValidationError) as error:
        validate_config(raw)

    assert [(item["loc"], item["type"]) for item in error.value.errors()] == [
        (("alerts", 0, "confirmation", "actions"), "model_type"),
    ]
    assert raw == original


def test_confirmation_actions_default_to_independent_disabled_groups() -> None:
    confirmation = ConfirmationConfig()
    other_confirmation = ConfirmationConfig()

    assert confirmation.actions.model_dump() == {"enabled": False, "items": []}
    assert confirmation.actions.items is not other_confirmation.actions.items


def test_validate_config_preserves_native_confirmation_action_list(alert_factory) -> None:
    actions = [
        {
            "action": "light.turn_on",
            "alias": "Turn on the hall light",
            "enabled": "{{ lights_enabled }}",
            "continue_on_error": True,
            "target": {"entity_id": ["light.hall"], "area_id": "hall"},
            "data": {"brightness": "{{ brightness }}", "transition": 2},
        },
        {
            "choose": [
                {
                    "conditions": "{{ notify_again }}",
                    "sequence": [{"action": "logbook.log", "data": {"message": "Confirmed"}}],
                }
            ],
            "default": [{"delay": {"seconds": "{{ delay_seconds }}"}}],
        },
    ]
    raw = {
        "alerts": [
            alert_factory(
                confirmation={"enabled": True, "actions": {"enabled": True, "items": actions}}
            )
        ]
    }
    original = deepcopy(raw)

    validated = validate_config(raw)
    confirmation = Configuration.model_validate(validated).alerts[0].confirmation

    assert confirmation is not None
    assert confirmation.actions.items == actions
    assert validated["alerts"][0]["confirmation"]["actions"] == {"enabled": True, "items": actions}
    assert validate_config(validated) == validated
    assert raw == original


def test_validate_config_preserves_confirmation_notification_opt_out() -> None:
    config = validate_config(
        {
            "alerts": [
                {
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
                }
            ]
        }
    )

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
        validate_config(
            {
                "alerts": [
                    {
                        "id": "confirm_alert",
                        "monitor": {"conditions": {"startup": True}},
                        "notification": {"action": "notify.mobile_app_phone"},
                        "confirmation": {
                            "enabled": True,
                            "reminders": {"enabled": True, "max_attempts": 0},
                        },
                    }
                ]
            }
        )


@pytest.mark.parametrize(
    "timeout",
    [0, "0", "00:00", "00:00:00", {"seconds": 0}],
)
def test_validate_config_rejects_zero_forget_after_timeout(timeout: object) -> None:
    with pytest.raises(ValidationError, match=r"reminders\.forget_after requires a positive value"):
        validate_config(
            {
                "alerts": [
                    {
                        "id": "confirm_alert",
                        "notification": {"action": "notify.mobile_app_phone"},
                        "confirmation": {
                            "enabled": True,
                            "reminders": {"forget_after": {"enabled": True, "value": timeout}},
                        },
                    }
                ]
            }
        )


def test_validate_config_keeps_zero_timeout_when_forget_after_is_disabled() -> None:
    config = validate_config(
        {
            "alerts": [
                {
                    "id": "confirm_alert",
                    "notification": {"action": "notify.mobile_app_phone"},
                    "confirmation": {
                        "enabled": True,
                        "reminders": {"forget_after": {"enabled": False, "value": 0}},
                    },
                }
            ]
        }
    )

    assert config["alerts"][0]["confirmation"]["reminders"]["forget_after"] == {
        "enabled": False,
        "value": 0,
    }


def test_configuration_preserves_native_extensions_on_canonical_models() -> None:
    raw = {
        "alerts": [
            {
                "id": "extended_alert",
                "notification": {
                    "action": "notify.mobile_app_phone",
                    "options": {"notification_native": {"priority": "high"}},
                },
                "confirmation": {
                    "enabled": True,
                    "buttons": [
                        {
                            "id": "confirm",
                            "label": "Confirm",
                            "button_native": "value",
                        }
                    ],
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
            }
        ]
    }

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


def test_full_feature_configuration_preserves_confirmation_actions_without_post_send_action(
    full_feature_alert: dict[str, object],
) -> None:
    validated = validate_config({"alerts": [full_feature_alert]})
    alert = Configuration.model_validate(validated).alerts[0]

    assert alert.model_dump(mode="python", exclude_none=True) == validated["alerts"][0]
    assert alert.confirmation is not None
    assert alert.confirmation.actions.items == [
        {
            "action": "light.turn_on",
            "target": {"entity_id": "light.hall"},
        }
    ]
    assert alert.post_send_actions is None


@pytest.mark.asyncio
async def test_async_save_config_rejects_invalid_data_before_entry_update() -> None:
    updates: list[dict[str, object]] = []

    class ConfigEntries:
        def async_update_entry(self, entry: object, **kwargs: object) -> None:
            updates.append(kwargs)

    class Hass:
        config_entries = ConfigEntries()
        data: ClassVar[dict[str, object]] = {}

    class Entry:
        options: ClassVar[dict[str, object]] = {}

    with pytest.raises(ValidationError):
        await async_save_config(Hass(), Entry(), {"version": 1, "alerts": [{"id": "Bad-ID"}]})
    assert updates == []


@pytest.mark.asyncio
async def test_async_save_config_updates_entry_runtime_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    updates: list[dict[str, object]] = []
    monkeypatch.setattr(
        "custom_components.ha_notifications.async_validate_alerts",
        lambda *_args, **_kwargs: asyncio.sleep(0, result=[]),
    )

    class ConfigEntries:
        def async_update_entry(self, entry: object, **kwargs: object) -> None:
            updates.append(kwargs)

    class Hass:
        config_entries = ConfigEntries()

    class Entry:
        options: ClassVar[dict[str, object]] = {}
        runtime_data = RuntimeData(config={"version": 1, "alerts": []}, automations=[])

    hass = Hass()
    entry = Entry()
    saved = await async_save_config(hass, entry, {"version": 1, "alerts": []})
    assert entry.runtime_data.config == saved
    assert updates == [{"options": saved}]
    assert entry.runtime_data.automations == []


def test_alert_helpers_find_replace_and_append_by_id() -> None:
    config = {"version": 1, "alerts": [{"id": "door"}, {"id": "window"}]}

    replaced = upsert_alert(config, {"id": "door", "name": "Door"})
    appended = upsert_alert(config, {"id": "garage"})

    assert replaced["alerts"] == [{"id": "door", "name": "Door"}, {"id": "window"}]
    assert [alert["id"] for alert in appended["alerts"]] == ["door", "window", "garage"]
    assert config["alerts"] == [{"id": "door"}, {"id": "window"}]
    assert find_alert(replaced, "door") == {"id": "door", "name": "Door"}
    assert find_alert(config, "missing") is None
