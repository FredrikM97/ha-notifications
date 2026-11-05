"""Tests for canonical Home Assistant automation generation."""

from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
import yaml
from homeassistant.components.automation.config import (
    ValidationStatus,
    async_validate_config,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.template import Template
from pydantic import ValidationError

from custom_components.ha_notifications.automation import (
    AutomationFragments,
    _ConfirmationActionFragments,
    _ConfirmationComponent,
    async_validate_alerts,
    component_registry,
    compose_automation,
    generate_automation,
    generate_automations,
    render_automation,
)
from custom_components.ha_notifications.automation_runtime import automation_status
from custom_components.ha_notifications.configuration import AlertConfig, validate_config


def _find_action(value: Any, status: str) -> dict[str, Any] | None:
    if isinstance(value, dict):
        data = value.get("data", {})
        if value.get("action") == "ha_notifications.report" and data.get("status") == status:
            return value
        return next(
            (found for nested in value.values() if (found := _find_action(nested, status))),
            None,
        )
    if isinstance(value, list):
        return next(
            (found for nested in value if (found := _find_action(nested, status))),
            None,
        )
    return None


def _active_sequence(generated: dict[str, Any]) -> list[dict[str, Any]]:
    def find_sequence(value: Any) -> list[dict[str, Any]] | None:
        if isinstance(value, list):
            if any(
                isinstance(action, dict)
                and action.get("action") == "ha_notifications.report"
                and action.get("data", {}).get("status") == "started"
                for action in value
            ):
                return value
            return next(
                (found for nested in value if (found := find_sequence(nested))),
                None,
            )
        if isinstance(value, dict):
            return next(
                (found for nested in value.values() if (found := find_sequence(nested))),
                None,
            )
        return None

    sequence = find_sequence(generated["actions"]) or generated["actions"]
    return [
        action
        for action in sequence
        if not (
            action.get("action") == "ha_notifications.report"
            and action.get("data", {}).get("status") in {"started", "completed"}
        )
    ]


def _inactive_sequence(generated: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    report = _find_action(generated, "inactive")
    return [report] if report is not None else []


def _assert_reported_stops(value: Any) -> None:
    if isinstance(value, list):
        for index, action in enumerate(value):
            if isinstance(action, dict) and "stop" in action:
                assert any(
                    isinstance(previous, dict)
                    and previous.get("action") == "ha_notifications.report"
                    for previous in value[:index]
                )
            _assert_reported_stops(action)
    elif isinstance(value, dict):
        for nested in value.values():
            _assert_reported_stops(nested)


class _ReadableYamlDumper(yaml.SafeDumper):
    def ignore_aliases(self, data: object) -> bool:
        return True


def _render_yaml(value: object) -> str:
    return yaml.dump(
        value,
        Dumper=_ReadableYamlDumper,
        sort_keys=False,
    ).rstrip()


@pytest.fixture
def automation_alert() -> dict[str, object]:
    return {
        "id": "low_water",
        "name": "Low water",
        "enabled": True,
        "monitor": {
            "inactive": {"enabled": False, "items": [], "clear_notification": False},
            "triggers": {
                "enabled": True,
                "items": [{"trigger": "state", "entity_id": "sensor.water"}],
            },
            "conditions": {
                "enabled": True,
                "items": [{"condition": "numeric_state", "entity_id": "sensor.water", "below": 20}],
                "startup": True,
                "interval": {"enabled": False, "value": 43200},
            },
        },
        "notification": {
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.phone", "notify.tablet"]},
            "message": "Low water",
        },
    }


def test_generate_automation_uses_explicit_triggers_and_active_branches(
    automation_alert, snapshot
) -> None:
    generated = generate_automation(automation_alert)
    assert _render_yaml(generated) == snapshot
    assert generate_automations(automation_alert) == [generated]


@pytest.mark.parametrize("group", ["mobile", "android", "ios"])
@pytest.mark.parametrize(
    ("group_enabled", "field_enabled"),
    [(True, True), (True, False), (False, True), (False, False)],
)
def test_generate_automation_filters_option_controls_without_changing_canonical_data(
    automation_alert,
    group: str,
    group_enabled: bool,
    field_enabled: bool,
    snapshot,
) -> None:
    automation_alert["notification"]["options"] = {
        "channel": "Saved channel",
        "ttl": 0,
        "sticky": False,
        "push": {"sound": "saved.aiff", "custom": {"values": [False, 0]}},
    }
    automation_alert["notification"]["option_controls"] = {
        group: {
            "enabled": group_enabled,
            "fields": {"channel": field_enabled, "push.sound": field_enabled},
        },
    }
    original = deepcopy(automation_alert)
    canonical = validate_config({"alerts": [automation_alert]})
    stored = deepcopy(canonical)
    alert = AlertConfig.model_validate(canonical["alerts"][0])
    generated = generate_automation(alert)
    send = _active_sequence(generated)[0]["data"]
    assert _render_yaml(generated) == snapshot
    send["payload"]["data"]["push"]["custom"]["values"].append("changed")
    assert alert.model_dump(exclude_none=True) == stored["alerts"][0]
    assert canonical == stored
    assert automation_alert == original


def test_generate_automation_rejects_persisted_mobile_options(automation_alert) -> None:
    mobile_options = {
        "general": {"fields": {"color": {"enabled": False, "value": "#ff0000"}}},
        "android": {"fields": {"channel": {"enabled": False, "value": "Disabled channel"}}},
        "ios": {"enabled": False, "values": {"sound": "disabled.aiff"}},
    }
    automation_alert["mobile_options"] = mobile_options
    with pytest.raises(ValidationError, match="mobile_options"):
        generate_automation(automation_alert)
    assert automation_alert["mobile_options"] == mobile_options


def test_started_by_event_type_handles_non_event_triggers(
    hass: HomeAssistant,
    automation_alert: dict[str, object],
) -> None:
    generated = generate_automation(automation_alert)
    event_type_template = _find_action(generated, "started")["data"]["details"]["started_by"][
        "event_type"
    ]
    template = Template(event_type_template, hass)

    assert (
        template.async_render(
            {
                "trigger": {"platform": "homeassistant", "event": "start"},
            }
        )
        == ""
    )
    assert (
        template.async_render(
            {
                "trigger": {
                    "platform": "event",
                    "event": SimpleNamespace(event_type="test_event"),
                },
            }
        )
        == "test_event"
    )


def test_started_by_description_defaults_when_trigger_metadata_is_missing(
    hass: HomeAssistant,
    automation_alert: dict[str, object],
) -> None:
    generated = generate_automation(automation_alert)
    description_template = _find_action(generated, "started")["data"]["details"]["started_by"][
        "description"
    ]
    template = Template(description_template, hass)

    assert template.async_render({}) == ""
    assert template.async_render({"trigger": {"platform": "state"}}) == ""
    assert (
        template.async_render(
            {
                "trigger": {"description": "Low water threshold"},
            }
        )
        == "Low water threshold"
    )


def test_trigger_and_condition_sections_can_be_disabled_independently(snapshot) -> None:
    alert = {
        "id": "section_flags",
        "enabled": True,
        "monitor": {
            "triggers": {
                "enabled": True,
                "items": [{"trigger": "event", "event_type": "door_opened"}],
            },
            "conditions": {
                "enabled": True,
                "startup": True,
                "interval": {"enabled": True, "value": 300},
                "items": [{"condition": "state", "entity_id": "binary_sensor.door", "state": "on"}],
            },
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }

    triggers_only = generate_automations(
        {
            **alert,
            "monitor": {
                **alert["monitor"],
                "conditions": {**alert["monitor"]["conditions"], "enabled": False},
            },
        }
    )[0]

    conditions_only = generate_automations(
        {
            **alert,
            "monitor": {
                **alert["monitor"],
                "triggers": {**alert["monitor"]["triggers"], "enabled": False},
            },
        }
    )[0]

    neither = {
        **alert,
        "monitor": {
            "triggers": {**alert["monitor"]["triggers"], "enabled": False},
            "conditions": {**alert["monitor"]["conditions"], "enabled": False},
        },
    }
    neither_generated = generate_automations(neither)
    assert (
        _render_yaml(
            {
                "triggers_only": triggers_only,
                "conditions_only": conditions_only,
                "neither": neither_generated,
            }
        )
        == snapshot
    )
    assert neither["enabled"] is True


@pytest.mark.asyncio
async def test_binary_state_trigger_preserves_duration_without_inferred_edge(
    hass: HomeAssistant,
    snapshot,
) -> None:
    generated = generate_automations(
        {
            "id": "button_alert",
            "monitor": {
                "triggers": {
                    "items": [
                        {
                            "trigger": "state",
                            "entity_id": "input_boolean.alert_button",
                            "from": "off",
                            "to": "on",
                            "for": {"seconds": 30},
                        }
                    ]
                },
                "conditions": {
                    "items": [
                        {
                            "condition": "state",
                            "entity_id": "input_boolean.alert_button",
                            "state": "on",
                        }
                    ]
                },
            },
            "notification": {"action": "notify.mobile_app_phone"},
        }
    )
    assert _render_yaml(generated) == snapshot
    validated = await async_validate_config(hass, {"automation": generated})
    assert len(validated["automation"]) == 1
    assert all(
        automation.validation_status is ValidationStatus.OK
        for automation in validated["automation"]
    )


def test_conditional_alert_generates_single_main_without_changing_triggers() -> None:
    alert = {
        "id": "conditional_alert",
        "monitor": {
            "triggers": {
                "items": [
                    {
                        "trigger": "state",
                        "entity_id": "input_boolean.alert_button",
                        "from": "off",
                        "to": "on",
                    }
                ]
            },
            "conditions": {
                "items": [
                    {
                        "condition": "state",
                        "entity_id": "input_boolean.alert_button",
                        "state": "on",
                    }
                ]
            },
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }
    active_edge = alert["monitor"]["triggers"]["items"][0]
    generated = generate_automations(alert)

    assert len(generated) == 1
    assert generated[0] == generate_automation(alert)
    assert generated[0]["triggers"] == [{**active_edge, "id": "0"}]


@pytest.mark.asyncio
async def test_unconditional_alert_has_no_inactive_handler_or_clear(
    hass: HomeAssistant,
    snapshot,
) -> None:
    generated = generate_automations(
        {
            "id": "unconditional_alert",
            "monitor": {
                "conditions": {"startup": True},
                "triggers": {
                    "items": [
                        {
                            "trigger": "state",
                            "entity_id": "input_boolean.alert_button",
                            "to": "on",
                        }
                    ]
                },
            },
            "name": "Button alert",
            "notification": {
                "action": "notify.mobile_app_phone",
                "target": {"entity_id": ["notify.phone"]},
                "title": "Button",
                "message": "Button pressed",
                "options": {"tag": "button_alert"},
            },
        }
    )

    main = generated[0]
    assert _render_yaml(generated) == snapshot
    validated = await async_validate_alerts(
        hass,
        [
            {
                "id": "unconditional_alert",
                "monitor": {
                    "triggers": {"items": main["triggers"]},
                },
                "notification": {"action": "notify.mobile_app_phone"},
            }
        ],
    )
    assert [automation["id"] for automation in validated] == [main["id"]]
    validated = await async_validate_config(hass, {"automation": generated})
    assert len(validated["automation"]) == 1
    assert all(
        automation.validation_status is ValidationStatus.OK
        for automation in validated["automation"]
    )


@pytest.mark.parametrize("trigger_id", [None, "front_door_open", "door_open"])
def test_conditional_alert_uses_generic_trigger_ids(
    trigger_id: str | None,
) -> None:
    alert = {
        "id": "door_alert",
        "monitor": {
            "triggers": {
                "items": [
                    {
                        "trigger": "state",
                        "entity_id": "binary_sensor.front_door",
                        "to": "on",
                    }
                ]
            },
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }
    alert["monitor"]["conditions"] = {
        "items": [
            {
                "condition": "state",
                "entity_id": "binary_sensor.front_door",
                "state": "on",
            }
        ]
    }
    if trigger_id is not None:
        alert["monitor"]["triggers"]["items"][0]["id"] = trigger_id
    generated = generate_automations(alert)

    assert len(generated) == 1
    expected_trigger = dict(alert["monitor"]["triggers"]["items"][0])
    expected_trigger["id"] = "0"
    assert generated[0]["triggers"] == [expected_trigger]
    assert compose_automation(alert).triggers == tuple(alert["monitor"]["triggers"]["items"])
    assert generated[0]["conditions"] == alert["monitor"]["conditions"]["items"]
    assert "choose" not in generated[0]["actions"][0]


def test_configured_trigger_ids_are_replaced_with_generic_ids(snapshot) -> None:
    alert = {
        "id": "door_alert",
        "monitor": {
            "triggers": {
                "items": [
                    {
                        "trigger": "state",
                        "id": "door_open",
                        "entity_id": "binary_sensor.front_door",
                        "to": "on",
                    },
                    {
                        "trigger": "state",
                        "id": "inactive_door_open",
                        "entity_id": "binary_sensor.back_door",
                        "to": "on",
                    },
                ]
            },
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }
    generated = generate_automation(alert)

    assert _render_yaml(generated) == snapshot
    assert len(generate_automations(alert)) == 1


@pytest.mark.parametrize("triggers_enabled", [False, True])
def test_conditional_alert_without_enabled_triggers_generates_trigger_less_automation(
    triggers_enabled: bool,
) -> None:
    generated = generate_automations(
        {
            "id": "no_main_triggers",
            "monitor": {
                "triggers": {
                    "enabled": triggers_enabled,
                    "items": []
                    if triggers_enabled
                    else [
                        {
                            "trigger": "state",
                            "entity_id": "binary_sensor.front_door",
                            "to": "on",
                        }
                    ],
                },
                "conditions": {
                    "items": [
                        {
                            "condition": "state",
                            "entity_id": "binary_sensor.front_door",
                            "state": "on",
                        }
                    ]
                },
            },
            "notification": {"action": "notify.mobile_app_phone"},
        }
    )

    assert len(generated) == 1
    assert generated[0]["triggers"] == []


def test_startup_condition_check_does_not_infer_door_watcher() -> None:
    startup_trigger = {"trigger": "homeassistant", "event": "start"}
    generated = generate_automations(
        {
            "id": "condition_tracking",
            "monitor": {
                "triggers": {"enabled": False, "items": []},
                "conditions": {
                    "startup": True,
                    "items": [
                        {
                            "condition": "state",
                            "entity_id": "binary_sensor.front_door",
                            "state": "on",
                        }
                    ],
                },
            },
            "notification": {"action": "notify.mobile_app_phone"},
        }
    )

    assert len(generated) == 1
    assert generated[0]["triggers"] == [{**startup_trigger, "id": "0"}]
    assert all(
        "entity_id" not in trigger for automation in generated for trigger in automation["triggers"]
    )


@pytest.mark.asyncio
async def test_unconditional_alert_keeps_only_configured_state_triggers(
    hass: HomeAssistant,
) -> None:
    configured_trigger = {
        "trigger": "state",
        "entity_id": "input_boolean.alert_button",
        "from": "off",
        "to": "on",
    }
    generated = generate_automations(
        {
            "id": "button_alert",
            "monitor": {
                "triggers": {"items": [configured_trigger]},
            },
            "notification": {"action": "notify.mobile_app_phone"},
        }
    )

    assert len(generated) == 1
    assert generated[0]["conditions"] == []
    assert generated[0]["triggers"] == [{**configured_trigger, "id": "0"}]
    validated = await async_validate_config(hass, {"automation": generated})
    assert validated["automation"][0].validation_status is ValidationStatus.OK


@pytest.mark.parametrize("conditions_enabled", [False, True])
async def test_front_door_conditions_do_not_block_parallel_inactive_trigger(
    hass: HomeAssistant,
    backend_alerts: dict[str, dict[str, Any]],
    conditions_enabled: bool,
    snapshot,
) -> None:
    alert = backend_alerts["front_door_switch"]
    alert["monitor"]["conditions"]["enabled"] = conditions_enabled
    if conditions_enabled:
        alert["monitor"]["conditions"]["items"] = [
            {
                "condition": "state",
                "entity_id": "input_boolean.front_door",
                "state": "on",
            }
        ]

    generated = generate_automations(alert)
    assert _render_yaml(generated) == snapshot
    validated = await async_validate_config(hass, {"automation": generated})
    assert all(item.validation_status is ValidationStatus.OK for item in validated["automation"])


@pytest.mark.asyncio
async def test_conditions_are_preserved_without_inferred_triggers(
    hass: HomeAssistant,
    snapshot,
) -> None:
    configured_trigger = {"trigger": "event", "event_type": "door_opened"}
    conditions = [
        {
            "condition": "state",
            "entity_id": "input_boolean.alert_button",
            "state": "on",
        },
        {
            "condition": "template",
            "value_template": "{{ is_state('binary_sensor.door', 'on') }}",
        },
    ]
    generated = generate_automations(
        {
            "id": "condition_change_alert",
            "monitor": {
                "triggers": {"enabled": True, "items": [configured_trigger]},
                "conditions": {"enabled": True, "items": conditions},
            },
            "notification": {"action": "notify.mobile_app_phone"},
        }
    )
    assert compose_automation(
        {
            "id": "condition_change_alert",
            "monitor": {
                "triggers": {"enabled": True, "items": [configured_trigger]},
                "conditions": {"enabled": True, "items": conditions},
            },
            "notification": {"action": "notify.mobile_app_phone"},
        }
    ).conditions == tuple(conditions)
    condition_only = generate_automations(
        {
            "id": "condition_only",
            "monitor": {"conditions": {"items": conditions}},
            "notification": {"action": "notify.mobile_app_phone"},
        }
    )
    assert _render_yaml({"triggered": generated, "condition_only": condition_only}) == snapshot
    validated = await async_validate_config(hass, {"automation": generated})
    assert all(
        automation.validation_status is ValidationStatus.OK
        for automation in validated["automation"]
    )


def test_binary_state_trigger_preserves_explicit_on_and_off_edges(snapshot) -> None:
    generated = generate_automation(
        {
            "id": "button_alert",
            "monitor": {
                "triggers": {
                    "items": [
                        {
                            "trigger": "state",
                            "entity_id": "input_boolean.alert_button",
                            "to": "on",
                        },
                        {
                            "trigger": "state",
                            "entity_id": "input_boolean.alert_button",
                            "to": "off",
                        },
                    ]
                },
            },
            "notification": {"action": "notify.mobile_app_phone"},
        }
    )

    assert _render_yaml(generated) == snapshot


def test_generate_automation_preserves_explicit_template_trigger(snapshot) -> None:
    alert = {
        "id": "template_alert",
        "monitor": {
            "triggers": {
                "items": [
                    {
                        "trigger": "template",
                        "value_template": "{{ is_state('binary_sensor.door', 'on') }}",
                    }
                ]
            },
            "conditions": {
                "items": [
                    {
                        "condition": "template",
                        "value_template": "{{ is_state('binary_sensor.door', 'on') }}",
                    }
                ]
            },
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }
    generated = generate_automation(alert)

    assert _render_yaml(generated) == snapshot
    assert compose_automation(alert).conditions == (
        {
            "condition": "template",
            "value_template": "{{ is_state('binary_sensor.door', 'on') }}",
        },
    )


@pytest.mark.asyncio
async def test_template_condition_trigger_passes_home_assistant_validation(
    hass: HomeAssistant,
) -> None:
    generated = generate_automation(
        {
            "id": "template_trigger_validation",
            "monitor": {
                "triggers": {
                    "items": [
                        {
                            "trigger": "template",
                            "value_template": "{{ is_state('input_boolean.alert_button', 'on') }}",
                        }
                    ]
                },
                "conditions": {
                    "startup": True,
                    "items": [
                        {
                            "condition": "template",
                            "value_template": "{{ is_state('input_boolean.alert_button', 'on') }}",
                        }
                    ],
                },
            },
            "notification": {"action": "notify.mobile_app_phone"},
        }
    )

    validated = await async_validate_config(hass, {"automation": [generated]})

    assert validated["automation"][0].validation_status is ValidationStatus.OK


@pytest.mark.asyncio
async def test_condition_schema_is_validated_before_automation_save(
    hass: HomeAssistant,
) -> None:
    valid_alert = {
        "id": "state_for",
        "monitor": {
            "triggers": {"items": [{"trigger": "state", "entity_id": "binary_sensor.door"}]},
            "conditions": {
                "items": [
                    {
                        "condition": "state",
                        "entity_id": "binary_sensor.door",
                        "state": "on",
                        "for": "00:20:00",
                    }
                ]
            },
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }
    validated = await async_validate_alerts(hass, [valid_alert])
    assert [item["id"] for item in validated] == ["ha_notifications_state_for"]

    invalid_alert = {
        **valid_alert,
        "id": "numeric_without_threshold",
        "monitor": {
            **valid_alert["monitor"],
            "conditions": {
                "items": [
                    {
                        "condition": "numeric_state",
                        "entity_id": "sensor.water",
                    }
                ]
            },
        },
    }
    with pytest.raises(HomeAssistantError, match="numeric_state"):
        await async_validate_alerts(hass, [invalid_alert])


def test_generate_automation_keeps_interval_trigger_and_condition(snapshot) -> None:
    generated = generate_automation(
        {
            "id": "interval_only",
            "monitor": {
                "conditions": {
                    "interval": {"enabled": True, "value": 300},
                    "items": [
                        {
                            "condition": "state",
                            "entity_id": "binary_sensor.door",
                            "state": "on",
                        }
                    ],
                },
            },
            "notification": {"action": "notify.mobile_app_phone"},
        }
    )

    assert _render_yaml(generated) == snapshot


@pytest.mark.parametrize("enabled", [False, True])
def test_generate_automation_rejects_flat_confirmation_action_list(
    automation_alert,
    enabled: bool,
) -> None:
    with pytest.raises(ValidationError, match=r"confirmation\.actions"):
        generate_automation(
            {
                **automation_alert,
                "confirmation": {
                    "enabled": enabled,
                    "actions": [{"action": "light.turn_on"}],
                },
            }
        )


@pytest.mark.asyncio
async def test_confirmation_action_list_preserves_native_fields_and_passes_ha_validation(
    hass: HomeAssistant,
    automation_alert,
    snapshot,
) -> None:
    actions = [
        {
            "action": "light.turn_on",
            "alias": "Turn on the hall light",
            "enabled": True,
            "continue_on_error": True,
            "target": {"entity_id": ["light.hall"]},
            "data": {"brightness": "{{ 128 }}", "transition": 2},
        },
        {
            "choose": [
                {
                    "conditions": "{{ true }}",
                    "sequence": [{"action": "logbook.log", "data": {"message": "Confirmed"}}],
                }
            ],
            "default": [{"delay": {"seconds": "{{ 1 }}"}}],
        },
    ]
    alert = {
        **automation_alert,
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "reminders": {"enabled": False},
            "actions": {"enabled": True, "items": actions},
        },
    }
    original = deepcopy(alert)

    generated = generate_automation(alert)
    completion = next(action for action in _active_sequence(generated) if "choose" in action)
    native_actions = [
        action
        for action in completion["choose"][0]["sequence"]
        if action.get("action") != "ha_notifications.report" and "stop" not in action
    ]

    assert _render_yaml(generated) == snapshot
    assert alert == original
    validated = await async_validate_config(hass, {"automation": [generated]})
    assert validated["automation"][0].validation_status is ValidationStatus.OK

    native_actions[0]["target"]["entity_id"].append("light.kitchen")
    native_actions[1]["choose"][0]["sequence"][0]["data"]["message"] = "Changed"
    assert alert == original


def test_confirmation_response_is_terminal_without_follow_up_actions(
    automation_alert, snapshot
) -> None:
    generated = generate_automation(
        {
            **automation_alert,
            "confirmation": {
                "enabled": True,
                "buttons": [{"id": "confirm", "label": "Confirm"}],
                "notification": {"enabled": False},
                "reminders": {"enabled": False},
            },
        }
    )

    assert _render_yaml(generated) == snapshot
    _assert_reported_stops(generated)


@pytest.mark.parametrize("main_tag", [True, False])
@pytest.mark.parametrize("follow_up_tag", [True, False])
async def test_generated_tag_metadata_is_independent_for_main_and_follow_up(
    hass: HomeAssistant,
    automation_alert,
    main_tag: bool,
    follow_up_tag: bool,
    snapshot,
) -> None:
    automation_alert["notification"]["use_default_tag"] = main_tag
    automation_alert["notification"]["options"] = {"tag": "main-custom"}
    automation_alert["monitor"]["inactive"] = {
        "enabled": True,
        "clear_notification": True,
        "items": [{"trigger": "event", "event_type": "inactive"}],
    }
    automation_alert["confirmation"] = {
        "enabled": True,
        "buttons": [{"id": "confirm", "label": "Done"}],
        "notification": {
            "enabled": True,
            "message": "Done",
            "use_default_tag": follow_up_tag,
            "options": {"tag": "follow-up-custom"},
        },
        "reminders": {"enabled": True, "max_attempts": 2},
    }
    generated = generate_automations(automation_alert)
    assert _render_yaml(generated) == snapshot
    assert await async_validate_alerts(hass, [automation_alert]) == generated


@pytest.mark.parametrize(
    ("group_enabled", "field_enabled"),
    [(False, True), (True, False)],
    ids=["disabled_group", "disabled_field"],
)
def test_generated_option_controls_are_independent_for_main_reminders_and_follow_up(
    automation_alert,
    group_enabled: bool,
    field_enabled: bool,
    snapshot,
) -> None:
    automation_alert["notification"]["options"] = {
        "channel": "Main saved",
        "push": {"sound": "main.aiff"},
    }
    automation_alert["notification"]["option_controls"] = {
        "android": {"enabled": group_enabled, "fields": {"channel": field_enabled}},
    }
    automation_alert["confirmation"] = {
        "enabled": True,
        "buttons": [{"id": "confirm", "label": "Done"}],
        "notification": {
            "enabled": True,
            "message": "Done",
            "options": {
                "channel": "Follow-up saved",
                "ttl": 0,
                "sticky": False,
                "push": {"sound": "follow-up.aiff", "custom": {"values": [False, 0]}},
            },
            "option_controls": {
                "ios": {"enabled": group_enabled, "fields": {"push.sound": field_enabled}},
            },
        },
        "reminders": {"enabled": True, "max_attempts": 2},
    }
    original = deepcopy(automation_alert)
    canonical = validate_config({"alerts": [automation_alert]})
    stored = deepcopy(canonical)
    alert = AlertConfig.model_validate(canonical["alerts"][0])
    generated = generate_automation(alert)
    sequence = _active_sequence(generated)
    outcome = next(action for action in sequence if "choose" in action)
    follow_up = next(
        action["data"]
        for action in outcome["choose"][0]["sequence"]
        if action.get("action") == "ha_notifications.send"
    )

    assert _render_yaml(generated) == snapshot
    follow_up["payload"]["data"]["push"]["custom"]["values"].append("changed")
    assert alert.model_dump(exclude_none=True) == stored["alerts"][0]
    assert canonical == stored
    assert automation_alert == original


@pytest.mark.parametrize("enabled", [False, True])
def test_confirmation_action_enablement_preserves_saved_actions(automation_alert, enabled) -> None:
    alert = deepcopy(automation_alert)
    alert["confirmation"] = {
        "enabled": True,
        "buttons": [{"id": "confirm", "label": "Done"}],
        "actions": {
            "enabled": enabled,
            "items": [{"action": "script.retained_confirmation_action"}],
        },
    }
    canonical = validate_config({"alerts": [alert]})
    original = deepcopy(canonical)
    generated = generate_automation(canonical["alerts"][0])
    assert ("script.retained_confirmation_action" in yaml.safe_dump(generated)) is enabled
    assert canonical == original
    assert canonical["alerts"][0]["confirmation"]["actions"] == alert["confirmation"]["actions"]


@pytest.mark.parametrize("show_attempts", [False, True], ids=["plain", "attempts"])
@pytest.mark.parametrize("title", ["", "Water alert"], ids=["empty_title", "original_title"])
def test_reminders_preserve_original_content_and_targets_separate_from_follow_up(
    automation_alert,
    show_attempts: bool,
    title: str,
    snapshot,
) -> None:
    generated = generate_automation(
        {
            **automation_alert,
            "notification": {
                **automation_alert["notification"],
                "title": title,
                "message": "Original low water message",
                "options": {"channel": "Main alerts", "push": {"sound": "default"}},
            },
            "confirmation": {
                "enabled": True,
                "buttons": [{"id": "confirm", "label": "Confirm"}],
                "notification": {
                    "enabled": True,
                    "action": "notify.mobile_app_follow_up",
                    "target": {"entity_id": ["notify.follow_up"]},
                    "title": "Follow-up title",
                    "message": "Follow-up confirmation message",
                    "options": {"channel": "Confirmations"},
                },
                "reminders": {
                    "enabled": True,
                    "max_attempts": 3,
                    "show_attempts": show_attempts,
                },
            },
        }
    )

    assert _render_yaml(generated) == snapshot


@pytest.mark.parametrize("timeout", [900, "00:15:00", {"minutes": 15}])
def test_forget_after_is_disabled_by_default_and_opt_in(automation_alert, timeout) -> None:
    base_confirmation = {
        "enabled": True,
        "buttons": [{"id": "confirm", "label": "Confirm"}],
        "notification": {"action": "notify.mobile_app_phone"},
        "reminders": {
            "enabled": True,
            "forget_after": {"enabled": False, "value": timeout},
        },
    }
    disabled = _active_sequence(
        generate_automation(
            {
                **automation_alert,
                "confirmation": base_confirmation,
            }
        )
    )
    assert "timeout" not in disabled[0]["data"]["payload"]["data"]

    enabled = _active_sequence(
        generate_automation(
            {
                **automation_alert,
                "confirmation": {
                    **base_confirmation,
                    "reminders": {
                        "enabled": True,
                        "forget_after": {"enabled": True, "value": timeout},
                    },
                },
            }
        )
    )
    assert enabled[0]["data"]["payload"]["data"]["timeout"] == 900


@pytest.mark.parametrize("notification_enabled", [True, False])
def test_confirmation_notification_opt_in_controls_only_follow_up_send(
    automation_alert: dict[str, object],
    notification_enabled: bool,
    snapshot,
) -> None:
    generated = generate_automation(
        {
            **automation_alert,
            "confirmation": {
                "enabled": True,
                "buttons": [{"id": "confirm", "label": "Confirm"}],
                "notification": {
                    "enabled": notification_enabled,
                    "action": "notify.mobile_app_phone",
                    "message": "Confirmed",
                },
                "actions": {"enabled": True, "items": [{"action": "light.turn_on"}]},
            },
        }
    )

    sequence = _active_sequence(generated)
    completion = next(action for action in sequence if "choose" in action)
    follow_up = completion["choose"][0]["sequence"]
    follow_up_sends = [
        action for action in follow_up if action.get("action") == "ha_notifications.send"
    ]

    assert _render_yaml(generated) == snapshot
    assert bool(follow_up_sends) is notification_enabled
    action_index = next(
        index for index, action in enumerate(follow_up) if action.get("action") == "light.turn_on"
    )
    if follow_up_sends:
        assert follow_up.index(follow_up_sends[0]) < action_index


def test_confirmation_button_action_is_an_event_identifier(full_feature_alert) -> None:
    branch = _active_sequence(generate_automation(full_feature_alert))
    send = branch[0]["data"]
    wait = next(action for action in branch if "wait_for_trigger" in action)

    button_action = send["payload"]["data"]["actions"][0]["action"]
    event_action = wait["wait_for_trigger"][0]["event_data"]["action"]

    assert button_action == event_action
    assert button_action.startswith("ha_notifications_")
    assert "." not in button_action


def test_confirmation_button_id_defaults_to_stable_response_identifier(
    automation_alert,
    snapshot,
) -> None:
    generated = generate_automation(
        {
            **automation_alert,
            "confirmation": {
                "enabled": True,
                "buttons": [{"label": "Confirm"}],
                "notification": {"message": "Confirmed"},
            },
        }
    )
    branch = _active_sequence(generated)
    send = branch[0]["data"]
    wait = next(action for action in branch if "wait_for_trigger" in action)

    assert send["payload"]["data"]["actions"][0]["action"].endswith("_response_1")
    assert wait["wait_for_trigger"][0]["event_data"]["action"].endswith("_response_1")
    assert _render_yaml(generated) == snapshot


async def test_generate_automation_full_feature_snapshot(
    hass: HomeAssistant,
    full_feature_alert,
    snapshot,
) -> None:
    generated = generate_automation(full_feature_alert)
    rendered = _render_yaml(generated)
    assert yaml.safe_load(rendered) == generated
    fixture = Path(__file__).parent / "fixtures" / "full_feature_automation.yaml"
    assert yaml.safe_load(fixture.read_text()) == generated
    assert fixture.read_text().rstrip() == rendered
    assert "&id" not in rendered
    assert "*id" not in rendered
    assert rendered == snapshot
    _assert_reported_stops(generated)
    validated = await async_validate_config(hass, {"automation": [generated]})
    assert len(validated["automation"]) == 1
    assert validated["automation"][0].validation_status is ValidationStatus.OK


def _nested_actions(value: Any) -> list[dict[str, Any]]:
    """Return every action mapping nested in a generated automation."""
    if isinstance(value, list):
        return [action for item in value for action in _nested_actions(item)]
    if not isinstance(value, dict):
        return []
    actions = (
        [value] if any(key in value for key in ("action", "repeat", "wait_for_trigger")) else []
    )
    return actions + [action for item in value.values() for action in _nested_actions(item)]


@pytest.mark.parametrize(
    ("case", "overrides"),
    [
        ("baseline", {}),
        (
            "post_send_enabled",
            {
                "post_send_actions": {
                    "enabled": True,
                    "items": [{"action": "logbook.log"}],
                },
            },
        ),
        (
            "confirmation_without_reminders",
            {
                "confirmation": {
                    "enabled": True,
                    "buttons": [{"id": "confirm", "label": "Confirm"}],
                    "notification": {
                        "action": "notify.mobile_app_phone",
                        "message": "Confirmed",
                    },
                    "reminders": {"enabled": False},
                },
            },
        ),
        (
            "confirmation_with_bounded_repeat",
            {
                "confirmation": {
                    "enabled": True,
                    "buttons": [{"id": "confirm", "label": "Confirm"}],
                    "notification": {
                        "action": "notify.mobile_app_phone",
                        "message": "Confirmed",
                    },
                    "actions": {"enabled": True, "items": [{"action": "light.turn_on"}]},
                    "reminders": {
                        "enabled": True,
                        "interval": {"minutes": 1},
                        "max_attempts": 2,
                    },
                },
            },
        ),
        (
            "disabled_optional_features",
            {
                "confirmation": {
                    "enabled": False,
                    "buttons": [{"id": "confirm", "label": "Confirm"}],
                    "reminders": {"enabled": True, "max_attempts": 4},
                },
                "post_send_actions": {
                    "enabled": False,
                    "items": [{"action": "logbook.log"}],
                },
            },
        ),
    ],
)
async def test_option_matrix_generates_valid_native_automations(
    hass: HomeAssistant,
    automation_alert: dict[str, object],
    case: str,
    overrides: dict[str, object],
    snapshot,
) -> None:
    alert = {
        **automation_alert,
        "id": f"matrix_{case}",
        **overrides,
    }

    generated = generate_automation(alert)
    rendered = _render_yaml(generated)
    round_tripped = yaml.safe_load(rendered)
    validated = await async_validate_config(hass, {"automation": [round_tripped]})

    assert round_tripped == generated
    assert rendered == snapshot
    assert validated["automation"][0].validation_status is ValidationStatus.OK

    _assert_reported_stops(generated)


def test_confirmation_timeout_and_retry_contract_is_native_and_bounded(snapshot) -> None:
    alert = {
        "id": "bounded_confirmation",
        "monitor": {"conditions": {"startup": True}},
        "notification": {"action": "notify.mobile_app_phone"},
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "reminders": {
                "enabled": True,
                "interval": 15,
                "max_attempts": 2,
            },
            "notification": {
                "enabled": True,
                "action": "notify.mobile_app_phone",
                "message": "Confirmed",
            },
            "actions": {"enabled": True, "items": [{"action": "light.turn_on"}]},
        },
        "post_send_actions": {
            "enabled": True,
            "items": [{"action": "logbook.log"}],
        },
    }

    generated = generate_automation(alert)
    branch = _active_sequence(generated)
    outcome = next(action for action in branch if "choose" in action)
    response = next(
        option
        for option in outcome["choose"]
        if option["conditions"][0]["value_template"] == "{{ wait.trigger.id == 'confirmation' }}"
    )

    assert _render_yaml(generated) == snapshot
    response_sequence = response["sequence"]
    notification_index = next(
        index
        for index, action in enumerate(response_sequence)
        if action.get("action") == "ha_notifications.send"
    )
    native_action_index = next(
        index
        for index, action in enumerate(response_sequence)
        if action.get("action") == "light.turn_on"
    )
    action_executed_index = next(
        index
        for index, action in enumerate(response_sequence)
        if action.get("action") == "ha_notifications.report"
        and action.get("data", {}).get("status") == "action_executed"
    )
    assert notification_index < native_action_index
    assert native_action_index < action_executed_index
    assert branch[1] not in response["sequence"]
    _assert_reported_stops(generated)


def test_confirmation_reminder_count_defaults_and_rejects_nonpositive_values() -> None:
    alert = {
        "id": "default_confirmation",
        "monitor": {"conditions": {"startup": True}},
        "notification": {"action": "notify.mobile_app_phone"},
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "reminders": {"enabled": True},
        },
    }

    branch = _active_sequence(generate_automation(alert))
    outcome = next(action for action in branch if "choose" in action)
    timeout_sequence = outcome["default"]
    repeat = next(action["repeat"] for action in timeout_sequence if "repeat" in action)
    assert repeat["count"] == 5

    with pytest.raises(ValueError, match="greater than or equal to 1"):
        generate_automation(
            {
                **alert,
                "id": "invalid_confirmation",
                "confirmation": {
                    **alert["confirmation"],
                    "reminders": {"enabled": True, "max_attempts": 0},
                },
            }
        )


def test_confirmation_action_extensions_are_assembled() -> None:
    class ExtraCompletion:
        name = "extra_completion"
        order = 25

        def compose(self, alert, confirmation):
            return _ConfirmationActionFragments(completion=({"action": "scene.turn_on"},))

    alert = AlertConfig.model_validate(
        {
            "id": "extended_confirmation",
            "monitor": {"conditions": {"startup": True}},
            "notification": {"action": "notify.mobile_app_phone"},
            "confirmation": {
                "enabled": True,
                "buttons": [{"id": "confirm", "label": "Confirm"}],
            },
        }
    )

    generated = _ConfirmationComponent((ExtraCompletion(),)).compose(alert)

    response_branch = next(
        branch
        for action in generated.actions
        if "choose" in action
        for branch in action["choose"]
        if branch.get("conditions")
        and branch["conditions"][0].get("value_template")
        == "{{ wait.trigger.id == 'confirmation' }}"
    )
    assert {"action": "scene.turn_on"} in response_branch["sequence"]
    _assert_reported_stops(generated.actions)


def test_post_send_actions_remain_separate_from_confirmation_follow_up(
    full_feature_alert,
) -> None:
    post_send_action = {
        "action": "input_boolean.turn_off",
        "target": {"entity_id": "input_boolean.front_door"},
    }
    alert = {
        **full_feature_alert,
        "post_send_actions": {"enabled": True, "items": [post_send_action]},
    }
    generated = generate_automation(alert)
    branch = _active_sequence(generated)
    completion = next(action for action in branch if "choose" in action)

    assert branch[1] == post_send_action
    assert post_send_action not in completion["choose"][0]["sequence"]


def test_automation_boundary_preserves_persisted_native_extensions(snapshot) -> None:
    alert = {
        "id": "extended",
        "name": "Extended",
        "monitor": {"conditions": {"startup": True}},
        "notification": {
            "action": "notify.mobile_app_phone",
            "options": {"native_notification": {"priority": "high"}},
        },
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm", "button_native": "value"}],
            "notification": {
                "enabled": True,
                "action": "notify.mobile_app_phone",
                "options": {"native_confirmation": {"channel": "alerts"}},
            },
            "reminders": {
                "enabled": True,
                "interval": {"minutes": 5},
                "max_attempts": 2,
                "reminder_native": True,
            },
            "confirmation_native": "value",
        },
        "post_send_actions": {
            "enabled": True,
            "items": [{"action": "light.turn_on"}],
        },
    }

    validated = AlertConfig.model_validate(alert)

    assert isinstance(validated, AlertConfig)
    generated = generate_automation(alert)
    assert (
        _render_yaml({"stored": validated.model_dump(exclude_none=True), "generated": generated})
        == snapshot
    )


def test_generate_automation_does_not_mutate_alert_config_native_values(snapshot) -> None:
    alert = AlertConfig.model_validate(
        {
            "id": "native_values",
            "monitor": {
                "conditions": {
                    "startup": True,
                    "items": [
                        {
                            "condition": "template",
                            "value_template": "{{ states('sensor.water') }}",
                            "native_condition": {"nested": ["preserve"]},
                        }
                    ],
                },
            },
            "notification": {
                "action": "notify.mobile_app_phone",
                "target": {"entity_id": ["notify.phone"]},
                "options": {"native_notification": {"channel": {"name": "alerts"}}},
            },
            "post_send_actions": {
                "enabled": True,
                "items": [
                    {
                        "action": "light.turn_on",
                        "data": {"brightness": 128},
                        "native_action": {"preserve": True},
                    }
                ],
            },
        }
    )
    before = alert.model_dump(mode="python")

    generated = generate_automation(alert)

    assert alert.model_dump(mode="python") == before
    assert _render_yaml(generated) == snapshot
    assert alert.model_dump(mode="python") == before


def test_generate_automation_preserves_post_send_actions() -> None:
    alert = {
        "id": "door_open",
        "monitor": {"conditions": {"startup": True}},
        "notification": {"action": "notify.mobile_app_phone"},
        "post_send_actions": {
            "enabled": True,
            "items": [{"action": "light.turn_on", "target": {"entity_id": "light.hall"}}],
        },
    }
    sequence = _active_sequence(generate_automation(alert))
    assert sequence[-2] == alert["post_send_actions"]["items"][0]
    assert sequence[-1]["action"] == "ha_notifications.report"
    assert sequence[-1]["data"]["status"] == "action_executed"


@pytest.mark.parametrize("clear_notification", [False, True])
async def test_explicit_inactive_trigger_runs_in_parallel_and_validates(
    hass: HomeAssistant,
    automation_alert,
    clear_notification: bool,
    snapshot,
) -> None:
    native_trigger = {
        "trigger": "state",
        "entity_id": "binary_sensor.door",
        "from": "on",
        "to": "off",
        "id": "door_closed",
        "alias": "Door closed",
    }
    automation_alert["monitor"]["inactive"] = {
        "enabled": True,
        "items": [native_trigger],
        "clear_notification": clear_notification,
    }

    generated = generate_automations(automation_alert)

    assert _render_yaml(generated) == snapshot
    validated = await async_validate_config(hass, {"automation": generated})
    assert all(item.validation_status is ValidationStatus.OK for item in validated["automation"])
    assert await async_validate_alerts(hass, [automation_alert]) == generated


@pytest.mark.parametrize(
    "enabled,items", [(False, [{"trigger": "event", "event_type": "closed"}]), (True, [])]
)
def test_inactive_triggers_require_enablement_and_explicit_items(
    automation_alert,
    enabled: bool,
    items: list[dict[str, Any]],
) -> None:
    automation_alert["monitor"]["inactive"] = {
        "enabled": enabled,
        "items": items,
        "clear_notification": True,
    }

    generated = generate_automations(automation_alert)

    assert generated == [generate_automation(automation_alert)]
    assert "ha_notifications.command" not in _render_yaml(generated)
    assert "ha_notifications.clear" not in _render_yaml(generated)


@pytest.mark.parametrize("triggers_enabled", [False, True])
def test_inactive_triggers_are_parallel_without_active_triggers(
    triggers_enabled: bool,
    snapshot,
) -> None:
    alert = {
        "id": "door",
        "monitor": {
            "triggers": {
                "enabled": triggers_enabled,
                "items": [] if triggers_enabled else [{"trigger": "event", "event_type": "opened"}],
            },
            "inactive": {
                "enabled": True,
                "items": [{"trigger": "state", "entity_id": "binary_sensor.door", "to": "off"}],
            },
        },
        "notification": {},
    }

    generated = generate_automations(alert)

    assert _render_yaml(generated) == snapshot


@pytest.mark.asyncio
async def test_trigger_less_alert_generates_valid_automation(hass: HomeAssistant) -> None:
    generated = generate_automations(
        {"id": "no_trigger", "notification": {"action": "notify.mobile_app_phone"}}
    )

    assert len(generated) == 1
    assert generated[0]["triggers"] == []
    validated = await async_validate_config(hass, {"automation": generated})
    assert validated["automation"][0].validation_status is ValidationStatus.OK


def test_component_registry_is_deterministic_and_extensions_follow_built_ins(
    automation_alert,
    snapshot,
) -> None:
    class Extension:
        name = "extension"
        order = 50

        def compose(self, _alert):
            return AutomationFragments(
                conditions=(
                    {
                        "condition": "state",
                        "entity_id": "binary_sensor.extension",
                        "state": "on",
                    },
                ),
                actions=({"action": "script.extension"},),
            )

    names = [component.name for component in component_registry((Extension(),))]
    generated = generate_automations(
        automation_alert,
        (Extension(),),
    )
    assert _render_yaml({"components": names, "automations": generated}) == snapshot


def test_renderer_preserves_native_boundaries_and_conditions(automation_alert, snapshot) -> None:
    alert = {
        **automation_alert,
        "monitor": {
            "triggers": {
                "items": [
                    {"trigger": "state", "entity_id": ["sensor.z", "sensor.a"]},
                    {"trigger": "state", "entity_id": "sensor.m"},
                ]
            },
            "conditions": {
                "startup": True,
                "interval": {"enabled": True, "value": 300},
                "items": [
                    {
                        "condition": "and",
                        "conditions": [
                            {"condition": "state", "entity_id": ["sensor.z", "sensor.a"]},
                            {
                                "condition": "or",
                                "conditions": [
                                    {"condition": "numeric_state", "entity_id": "sensor.m"},
                                ],
                            },
                        ],
                    }
                ],
            },
        },
    }
    generated = render_automation(alert, compose_automation(alert))
    assert _render_yaml(generated) == snapshot
    assert len(generate_automations(alert)) == 1
    assert _inactive_sequence(generated) == []


def test_failed_conditions_do_not_generate_inactive_reports(automation_alert) -> None:
    alert = {
        **automation_alert,
        "monitor": {
            **automation_alert["monitor"],
            "conditions": {
                **automation_alert["monitor"]["conditions"],
                "items": [
                    {
                        "condition": "state",
                        "entity_id": "binary_sensor.door",
                        "state": "on",
                    }
                ],
            },
        },
    }

    generated = generate_automations(alert)

    assert len(generated) == 1
    assert generated[0]["conditions"] == alert["monitor"]["conditions"]["items"]
    assert _inactive_sequence(generated[0]) == []


@pytest.mark.asyncio
async def test_automation_changes_returns_explicit_document_and_deletion_ids(
    hass: HomeAssistant,
    automation_alert,
    snapshot,
) -> None:
    from custom_components.ha_notifications.automation_runtime import (
        automation_changes,
    )

    generated = await async_validate_alerts(hass, [automation_alert])
    changes = automation_changes(generated, ["ha_notifications_deleted"])

    assert _render_yaml(changes) == snapshot
    assert automation_status(generated, automation_alert) == "managed"
