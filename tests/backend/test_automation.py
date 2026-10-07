"""Tests for canonical Home Assistant automation generation."""

import asyncio
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
from custom_components.ha_notifications.automation_runtime import (
    async_reconcile_automations,
    automation_status,
    ensure_automation_include,
)
from custom_components.ha_notifications.automation_storage import (
    write_automation_files,
)
from custom_components.ha_notifications.configuration import AlertConfig
from custom_components.ha_notifications.const import AUTOMATION_FILE


def _find_action(value: Any, status: str) -> dict[str, Any] | None:
    if isinstance(value, dict):
        data = value.get("data", {})
        if (
            value.get("action") == "ha_notifications.report"
            and data.get("status") == status
        ):
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


def _managed_notification(notification: dict[str, Any]) -> dict[str, Any]:
    """Return the selector-driven payload emitted by managed services."""
    return {
        **{key: notification[key] for key in ("action", "target") if notification.get(key)},
        "use_default_tag": notification.get("use_default_tag", True),
        "payload": {
            "title": notification.get("title", ""),
            "message": notification.get("message", ""),
            "data": deepcopy(notification.get("options", {})),
        },
    }


@pytest.fixture
def automation_alert() -> dict[str, object]:
    return {
        "id": "low_water",
        "name": "Low water",
        "enabled": True,
        "monitor": {
            "automation_mode": "parallel",
            "inactive": {"enabled": False, "items": [], "clear_notification": False},
            "triggers": {
                "enabled": True,
                "items": [{"trigger": "state", "entity_id": "sensor.water"}],
            },
            "conditions": {
                "enabled": True,
                "items": [{"condition": "numeric_state", "entity_id": "sensor.water", "below": 20}],
                "startup": True,
                "periodic": False,
            },
        },
        "notification": {
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.phone", "notify.tablet"]},
            "message": "Low water",
        },
    }


def test_generate_automation_uses_explicit_triggers_and_active_branches(automation_alert) -> None:
    generated = generate_automation(automation_alert)
    notification = _managed_notification(automation_alert["notification"])
    assert generated["conditions"][0]["condition"] == "or"
    assert generated["conditions"][0]["conditions"][0]["conditions"][0] == automation_alert["monitor"]["conditions"]["items"][0]
    assert generated["triggers"] == [
        {"trigger": "homeassistant", "event": "start"},
        {"trigger": "state", "entity_id": "sensor.water"},
    ]
    assert _active_sequence(generated)[0] == {
        "action": "ha_notifications.send",
        "data": {
            "alert_id": automation_alert["id"],
            "alert_name": automation_alert["name"],
            "flow_id": "{{ context.parent_id or context.id }}",
            **notification,
        },
    }


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
    event_type_template = _find_action(generated, "started")["data"]["details"][
        "started_by"
    ]["event_type"]
    template = Template(event_type_template, hass)

    assert template.async_render({
        "trigger": {"platform": "homeassistant", "event": "start"},
    }) == ""
    assert template.async_render({
        "trigger": {
            "platform": "event",
            "event": SimpleNamespace(event_type="test_event"),
        },
    }) == "test_event"


def test_started_by_description_defaults_when_trigger_metadata_is_missing(
    hass: HomeAssistant,
    automation_alert: dict[str, object],
) -> None:
    generated = generate_automation(automation_alert)
    description_template = _find_action(generated, "started")["data"]["details"][
        "started_by"
    ]["description"]
    template = Template(description_template, hass)

    assert template.async_render({}) == ""
    assert template.async_render({"trigger": {"platform": "state"}}) == ""
    assert template.async_render({
        "trigger": {"description": "Low water threshold"},
    }) == "Low water threshold"


def test_conditional_alert_keeps_inactive_report_without_companion(automation_alert) -> None:
    generated = generate_automations(automation_alert)

    assert len(generated) == 1
    main = generated[0]
    assert main["id"] == "ha_notifications_low_water"
    assert main["mode"] == "parallel"
    assert any(trigger.get("entity_id") == "sensor.water" for trigger in main["triggers"])
    inactive = _inactive_sequence(main)[0]
    assert inactive["data"]["status"] == "inactive"
    assert "cancel_on_inactive" not in inactive["data"]

    assert main == generate_automation(automation_alert)
    rendered = _render_yaml(main)
    assert "ha_notifications_inactive" not in rendered
    assert "ha_notifications.clear" not in rendered


def test_trigger_and_condition_sections_can_be_disabled_independently() -> None:
    alert = {
        "id": "section_flags",
        "enabled": True,
        "monitor": {
            "triggers": {"enabled": True, "items": [{"trigger": "event", "event_type": "door_opened"}]},
            "conditions": {
                "enabled": True,
                "startup": True,
                "periodic": True,
                "interval": 300,
                "items": [{"condition": "state", "entity_id": "binary_sensor.door", "state": "on"}],
            },
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }

    triggers_only = generate_automations({
        **alert,
        "monitor": {**alert["monitor"], "conditions": {**alert["monitor"]["conditions"], "enabled": False}},
    })[0]
    assert triggers_only["conditions"] == []
    assert [trigger["trigger"] for trigger in triggers_only["triggers"]] == ["event"]
    assert triggers_only["initial_state"] is True

    conditions_only = generate_automations({
        **alert,
        "monitor": {**alert["monitor"], "triggers": {**alert["monitor"]["triggers"], "enabled": False}},
    })[0]
    assert conditions_only["conditions"]
    enabled_trigger_types = [trigger["trigger"] for trigger in conditions_only["triggers"]]
    assert "event" not in enabled_trigger_types
    assert "homeassistant" in enabled_trigger_types
    assert "time_pattern" in enabled_trigger_types
    assert conditions_only["initial_state"] is True

    neither = {
        **alert,
        "monitor": {
            "triggers": {**alert["monitor"]["triggers"], "enabled": False},
            "conditions": {**alert["monitor"]["conditions"], "enabled": False},
        },
    }
    assert generate_automations(neither) == []
    assert neither["enabled"] is True


@pytest.mark.asyncio
async def test_binary_state_trigger_preserves_duration_without_inferred_edge(
    hass: HomeAssistant,
) -> None:
    generated = generate_automations({
        "id": "button_alert",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {"items": [{
                "trigger": "state",
                "entity_id": "input_boolean.alert_button",
                "from": "off",
                "to": "on",
                "for": {"seconds": 30},
            }]},
            "conditions": {"items": [{
                "condition": "state",
                "entity_id": "input_boolean.alert_button",
                "state": "on",
            }]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    })
    main = generated[0]

    expected_triggers = [
        {
            "trigger": "state",
            "entity_id": "input_boolean.alert_button",
            "from": "off",
            "to": "on",
            "for": {"seconds": 30},
        },
    ]
    assert main["triggers"] == expected_triggers
    assert len(generated) == 1
    assert main["conditions"][0]["condition"] == "or"
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
            "automation_mode": "parallel",
            "triggers": {"items": [{
                "trigger": "state",
                "entity_id": "input_boolean.alert_button",
                "from": "off",
                "to": "on",
            }]},
            "conditions": {"items": [{
                "condition": "state",
                "entity_id": "input_boolean.alert_button",
                "state": "on",
            }]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }
    active_edge = alert["monitor"]["triggers"]["items"][0]
    generated = generate_automations(alert)

    assert len(generated) == 1
    assert generated[0] == generate_automation(alert)
    assert generated[0]["triggers"] == [active_edge]


@pytest.mark.asyncio
async def test_unconditional_alert_has_no_inactive_handler_or_clear(
    hass: HomeAssistant,
) -> None:
    generated = generate_automations({
        "id": "unconditional_alert",
        "monitor": {
            "automation_mode": "parallel",
            "conditions": {"startup": True},
            "triggers": {"items": [{
                "trigger": "state",
                "entity_id": "input_boolean.alert_button",
                "to": "on",
            }]},
        },
        "name": "Button alert",
        "notification": {
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.phone"]},
            "title": "Button", "message": "Button pressed", "options": {"tag": "button_alert"},
        },
    })

    main = generated[0]
    assert len(generated) == 1
    assert main["conditions"] == []
    assert main["triggers"] == [
        {"trigger": "homeassistant", "event": "start"},
        {
            "trigger": "state",
            "entity_id": "input_boolean.alert_button",
            "to": "on",
        },
    ]
    assert _inactive_sequence(main) == []
    rendered = _render_yaml(main)
    assert "ha_notifications_inactive" not in rendered
    assert "ha_notifications.clear" not in rendered
    assert "cancel_on_inactive" not in rendered
    validated = await async_validate_alerts(hass, [{
        "id": "unconditional_alert",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {"items": main["triggers"]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }])
    assert [automation["id"] for automation in validated] == [main["id"]]
    validated = await async_validate_config(hass, {"automation": generated})
    assert len(validated["automation"]) == 1
    assert all(
        automation.validation_status is ValidationStatus.OK
        for automation in validated["automation"]
    )


@pytest.mark.parametrize("trigger_id", [None, "front_door_open", "1"])
def test_conditional_alert_preserves_configured_trigger_ids(
    trigger_id: str | None,
) -> None:
    alert = {
        "id": "door_alert",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {"items": [{
                "trigger": "state",
                "entity_id": "binary_sensor.front_door",
                "to": "on",
            }]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }
    alert["monitor"]["conditions"] = {"items": [{
        "condition": "state",
        "entity_id": "binary_sensor.front_door",
        "state": "on",
    }]}
    if trigger_id is not None:
        alert["monitor"]["triggers"]["items"][0]["id"] = trigger_id
    generated = generate_automations(alert)

    assert len(generated) == 1
    assert generated[0]["triggers"] == alert["monitor"]["triggers"]["items"]
    assert compose_automation(alert).triggers == tuple(alert["monitor"]["triggers"]["items"])
    assert generated[0]["conditions"][0]["conditions"][1]["conditions"][0]["id"] == [
        trigger_id if trigger_id is not None else "0",
    ]


def test_inactive_prefixed_trigger_id_is_not_reserved() -> None:
    alert = {
        "id": "door_alert",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {"items": [
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
            ]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }
    generated = generate_automation(alert)

    assert generated["triggers"] == alert["monitor"]["triggers"]["items"]
    assert len(generate_automations(alert)) == 1


@pytest.mark.parametrize("triggers_enabled", [False, True])
def test_conditional_alert_does_not_generate_automation_without_enabled_triggers(
    triggers_enabled: bool,
) -> None:
    assert generate_automations({
        "id": "no_main_triggers",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {
                "enabled": triggers_enabled,
                "items": [] if triggers_enabled else [{
                    "trigger": "state",
                    "entity_id": "binary_sensor.front_door",
                    "to": "on",
                }],
            },
            "conditions": {"items": [{
                "condition": "state",
                "entity_id": "binary_sensor.front_door",
                "state": "on",
            }]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }) == []


def test_startup_condition_check_does_not_infer_door_watcher() -> None:
    startup_trigger = {"trigger": "homeassistant", "event": "start"}
    generated = generate_automations({
        "id": "condition_tracking",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {"enabled": False, "items": []},
            "conditions": {"startup": True, "items": [{
                "condition": "state",
                "entity_id": "binary_sensor.front_door",
                "state": "on",
            }]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    })

    assert len(generated) == 1
    assert generated[0]["triggers"] == [startup_trigger]
    assert all(
        "entity_id" not in trigger
        for automation in generated
        for trigger in automation["triggers"]
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
    generated = generate_automations({
        "id": "button_alert",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {"items": [configured_trigger]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    })

    assert len(generated) == 1
    assert generated[0]["conditions"] == []
    assert generated[0]["triggers"] == [configured_trigger]
    validated = await async_validate_config(hass, {"automation": generated})
    assert validated["automation"][0].validation_status is ValidationStatus.OK


@pytest.mark.asyncio
async def test_conditions_are_preserved_without_inferred_triggers(
    hass: HomeAssistant,
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
    generated = generate_automations({
        "id": "condition_change_alert",
        "monitor": {
            "triggers": {"enabled": True, "items": [configured_trigger]},
            "conditions": {"enabled": True, "items": conditions},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    })
    main = generated[0]

    assert [
        {key: value for key, value in trigger.items() if key != "id"}
        for trigger in main["triggers"]
    ] == [configured_trigger]
    assert compose_automation({
        "id": "condition_change_alert",
        "monitor": {
            "triggers": {"enabled": True, "items": [configured_trigger]},
            "conditions": {"enabled": True, "items": conditions},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }).conditions == tuple(conditions)
    assert generate_automations({
        "id": "condition_only",
        "monitor": {"conditions": {"items": conditions}},
        "notification": {"action": "notify.mobile_app_phone"},
    }) == []
    validated = await async_validate_config(hass, {"automation": generated})
    assert all(
        automation.validation_status is ValidationStatus.OK
        for automation in validated["automation"]
    )


def test_binary_state_trigger_preserves_explicit_on_and_off_edges() -> None:
    generated = generate_automation({
        "id": "button_alert",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {"items": [
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
            ]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    })

    assert generated["triggers"] == [
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


def test_generate_automation_preserves_explicit_template_trigger() -> None:
    alert = {
        "id": "template_alert",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {"items": [{
                "trigger": "template",
                "value_template": "{{ is_state('binary_sensor.door', 'on') }}",
            }]},
            "conditions": {"items": [{
                "condition": "template",
                "value_template": "{{ is_state('binary_sensor.door', 'on') }}",
            }]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    }
    generated = generate_automation(alert)

    assert {
        key: value for key, value in generated["triggers"][0].items()
        if key != "id"
    } == {
        "trigger": "template",
        "value_template": "{{ is_state('binary_sensor.door', 'on') }}",
    }
    assert len(generated["triggers"]) == 1
    assert compose_automation(alert).conditions == ({
        "condition": "template",
        "value_template": "{{ is_state('binary_sensor.door', 'on') }}",
    },)


@pytest.mark.asyncio
async def test_template_condition_trigger_passes_home_assistant_validation(
    hass: HomeAssistant,
) -> None:
    generated = generate_automation({
        "id": "template_trigger_validation",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {"items": [{
                "trigger": "template",
                "value_template": "{{ is_state('input_boolean.alert_button', 'on') }}",
            }]},
            "conditions": {"startup": True, "items": [{
                "condition": "template",
                "value_template": "{{ is_state('input_boolean.alert_button', 'on') }}",
            }]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    })

    validated = await async_validate_config(hass, {"automation": [generated]})

    assert validated["automation"][0].validation_status is ValidationStatus.OK


@pytest.mark.asyncio
async def test_condition_schema_is_validated_before_automation_save(
    hass: HomeAssistant,
) -> None:
    valid_alert = {
        "id": "state_for",
        "monitor": {
            "automation_mode": "parallel",
            "triggers": {"items": [{"trigger": "state", "entity_id": "binary_sensor.door"}]},
            "conditions": {"items": [{
                "condition": "state",
                "entity_id": "binary_sensor.door",
                "state": "on",
                "for": "00:20:00",
            }]},
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
            "conditions": {"items": [{
                "condition": "numeric_state",
                "entity_id": "sensor.water",
            }]},
        },
    }
    with pytest.raises(HomeAssistantError, match="numeric_state"):
        await async_validate_alerts(hass, [invalid_alert])


def test_generate_automation_keeps_periodic_trigger_and_condition() -> None:
    generated = generate_automation({
        "id": "interval_only",
        "monitor": {
            "automation_mode": "parallel",
            "conditions": {"periodic": True, "interval": 300, "items": [{
                "condition": "state",
                "entity_id": "binary_sensor.door",
                "state": "on",
            }]},
        },
        "notification": {"action": "notify.mobile_app_phone"},
    })

    assert {
        key: value for key, value in generated["triggers"][0].items()
        if key != "id"
    } == {"trigger": "time_pattern", "minutes": "/5"}
    assert generated["conditions"][0]["conditions"][0]["conditions"][0] == {
        "condition": "state",
        "entity_id": "binary_sensor.door",
        "state": "on",
    }


def test_disabled_confirmation_removes_wait_completion_and_repeat(automation_alert) -> None:
    generated = generate_automation({
        **automation_alert,
        "confirmation": {
            "enabled": False,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "reminders": {"enabled": True, "max_attempts": 5},
        },
    })

    sequence = _active_sequence(generated)
    assert [action["action"] for action in sequence] == ["ha_notifications.send"]
    assert not any("wait_for_trigger" in action for action in sequence)
    assert not any("repeat" in action for action in sequence)


def test_disabled_reminders_keep_confirmation_but_remove_repeat(automation_alert) -> None:
    generated = generate_automation({
        **automation_alert,
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {
                "action": "notify.mobile_app_phone",
                "message": "Confirmed",
            },
            "reminders": {"enabled": False, "max_attempts": 5},
        },
    })

    sequence = _active_sequence(generated)
    assert sequence[0]["action"] == "ha_notifications.send"
    assert any("wait_for_trigger" in action for action in sequence)
    assert any("choose" in action for action in sequence)
    assert not any("repeat" in action for action in sequence)


@pytest.mark.parametrize("enabled", [False, True])
def test_generate_automation_rejects_confirmation_actions_wrapper(
    automation_alert, enabled: bool,
) -> None:
    with pytest.raises(ValidationError, match="confirmation.actions"):
        generate_automation({
            **automation_alert,
            "confirmation": {
                "enabled": enabled,
                "actions": {"items": [{"action": "light.turn_on"}]},
            },
        })


@pytest.mark.asyncio
async def test_confirmation_action_list_preserves_native_fields_and_passes_ha_validation(
    hass: HomeAssistant, automation_alert,
) -> None:
    actions = [{
        "action": "light.turn_on",
        "alias": "Turn on the hall light",
        "enabled": True,
        "continue_on_error": True,
        "target": {"entity_id": ["light.hall"]},
        "data": {"brightness": "{{ 128 }}", "transition": 2},
    }, {
        "choose": [{
            "conditions": "{{ true }}",
            "sequence": [{"action": "logbook.log", "data": {"message": "Confirmed"}}],
        }],
        "default": [{"delay": {"seconds": "{{ 1 }}"}}],
    }]
    alert = {
        **automation_alert,
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "reminders": {"enabled": False},
            "actions": actions,
        },
    }
    original = deepcopy(alert)

    generated = generate_automation(alert)
    completion = next(action for action in _active_sequence(generated) if "choose" in action)
    native_actions = [
        action for action in completion["choose"][0]["sequence"]
        if action.get("action") != "ha_notifications.report" and "stop" not in action
    ]

    assert native_actions == actions
    assert alert == original
    validated = await async_validate_config(hass, {"automation": [generated]})
    assert validated["automation"][0].validation_status is ValidationStatus.OK

    native_actions[0]["target"]["entity_id"].append("light.kitchen")
    native_actions[1]["choose"][0]["sequence"][0]["data"]["message"] = "Changed"
    assert alert == original


def test_confirmation_response_is_terminal_without_follow_up_actions(automation_alert) -> None:
    generated = generate_automation({
        **automation_alert,
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "actions": [],
            "reminders": {"enabled": False},
        },
    })

    sequence = _active_sequence(generated)
    completion = next(action for action in sequence if "choose" in action)
    wait = next(action for action in sequence if "wait_for_trigger" in action)
    assert completion["choose"][0]["conditions"] == [{
        "condition": "template",
        "value_template": "{{ wait.trigger.id == 'confirmation' }}",
    }]
    assert wait["wait_for_trigger"][-1] == {
        "trigger": "event",
        "event_type": "ha_notifications_command",
        "id": "skip_confirmation",
        "event_data": {"alert_id": "low_water", "command": "skip_confirmation"},
    }
    assert wait["wait_for_trigger"][-2] == {
        "trigger": "event",
        "event_type": "ha_notifications_command",
        "id": "cancel_run",
        "event_data": {"alert_id": "low_water", "command": "cancel_run"},
    }
    assert wait["wait_for_trigger"][0]["id"] == "confirmation"
    assert completion["choose"][0]["sequence"][-1] == {
        "stop": "confirmation completed",
    }
    assert not any(
        action.get("data", {}).get("status") == "confirmation_resumed"
        for action in sequence
    )
    assert completion["choose"][1]["sequence"][-1] == {
        "stop": "Confirmation ended",
    }
    assert completion["choose"][1]["sequence"][0]["data"]["status"] == "cancelled"
    assert completion["default"][-1] == {"stop": "Confirmation ended"}
    assert completion["default"][-2]["data"]["status"] == "confirmation_timeout"


def test_every_terminal_stop_has_an_adjacent_report(automation_alert) -> None:
    generated = generate_automation({
        **automation_alert,
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"enabled": False},
            "actions": [],
            "reminders": {"enabled": False},
        },
    })

    _assert_reported_stops(generated)


def test_inactive_report_does_not_cancel_or_clear_without_explicit_feature(automation_alert) -> None:
    generated = generate_automations(automation_alert)

    assert len(generated) == 1
    assert "cancel_on_inactive" not in _inactive_sequence(generated[0])[0]["data"]
    assert "ha_notifications.command" not in _render_yaml(generated)
    assert "ha_notifications.clear" not in _render_yaml(generated)


@pytest.mark.parametrize("main_tag", [True, False])
@pytest.mark.parametrize("follow_up_tag", [True, False])
async def test_generated_tag_metadata_is_independent_for_main_and_follow_up(
    hass: HomeAssistant, automation_alert, main_tag: bool, follow_up_tag: bool,
) -> None:
    automation_alert["notification"]["use_default_tag"] = main_tag
    automation_alert["notification"]["options"] = {"tag": "main-custom"}
    automation_alert["monitor"]["inactive"] = {
        "enabled": True, "clear_notification": True,
        "items": [{"trigger": "event", "event_type": "inactive"}],
    }
    automation_alert["confirmation"] = {
        "enabled": True,
        "buttons": [{"id": "confirm", "label": "Done"}],
        "notification": {
            "enabled": True, "message": "Done", "use_default_tag": follow_up_tag,
            "options": {"tag": "follow-up-custom"},
        },
        "reminders": {"enabled": True, "max_attempts": 2},
    }
    generated = generate_automations(automation_alert)
    sequence = _active_sequence(generated[0])
    outcome = next(action for action in sequence if "choose" in action)
    repeat = next(action["repeat"] for action in outcome["default"] if "repeat" in action)
    follow_up = next(
        action for action in outcome["choose"][0]["sequence"]
        if action.get("action") == "ha_notifications.send"
    )
    for action in [sequence[0], repeat["sequence"][0], generated[1]["actions"][2], follow_up]:
        data = action["data"]
        is_follow_up = action is follow_up
        assert data["use_default_tag"] is (follow_up_tag if is_follow_up else main_tag)
        assert "use_default_tag" not in data["payload"]
        assert "use_default_tag" not in data["payload"]["data"]
        assert data["payload"]["data"]["tag"] == ("follow-up-custom" if is_follow_up else "main-custom")
    assert await async_validate_alerts(hass, [automation_alert]) == generated


def test_enabled_reminders_repeat_the_original_notification(automation_alert) -> None:
    generated = generate_automation({
        **automation_alert,
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {
                "action": "notify.mobile_app_phone",
                "message": "Confirmed",
            },
            "actions": [{"action": "light.turn_on"}],
            "reminders": {"enabled": True, "interval": 15, "max_attempts": 2},
        },
    })

    sequence = _active_sequence(generated)
    outcome = next(action for action in sequence if "choose" in action)
    timeout_sequence = outcome["default"]
    repeat = next(action["repeat"] for action in timeout_sequence if "repeat" in action)
    assert repeat["count"] == 2
    assert repeat["sequence"][0]["action"] == "ha_notifications.send"
    assert repeat["sequence"][0]["data"]["payload"]["message"] == automation_alert["notification"]["message"]
    assert repeat["sequence"][0]["data"]["target"] == automation_alert["notification"]["target"]
    assert any("wait_for_trigger" in action for action in repeat["sequence"])
    assert any("choose" in action for action in repeat["sequence"])


@pytest.mark.parametrize("show_attempts", [False, True], ids=["plain", "attempts"])
@pytest.mark.parametrize("title", ["", "Water alert"], ids=["empty_title", "original_title"])
def test_reminders_preserve_original_content_and_targets_separate_from_follow_up(
    automation_alert, show_attempts: bool, title: str,
) -> None:
    generated = generate_automation({
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
    })

    sequence = _active_sequence(generated)
    outcome = next(action for action in sequence if "choose" in action)
    repeat = next(
        action["repeat"]
        for action in outcome["default"]
        if "repeat" in action
    )
    reminder = repeat["sequence"][0]["data"]
    expected_title = title
    if show_attempts:
        attempt = "Attempt {{ repeat.index + 1 }}/3"
        expected_title = f"{title} - {attempt}" if title else attempt
    assert repeat["count"] == 3
    assert reminder["payload"]["title"] == expected_title
    assert reminder["payload"]["message"] == "Original low water message"
    assert reminder["action"] == automation_alert["notification"]["action"]
    assert reminder["target"] == automation_alert["notification"]["target"]
    assert reminder["payload"]["data"]["channel"] == "Main alerts"
    assert reminder["payload"]["data"]["push"] == {"sound": "default"}
    assert sequence[0]["data"]["payload"]["title"] == title
    assert sequence[0]["data"]["payload"]["message"] == "Original low water message"
    for completion in [outcome, next(action for action in repeat["sequence"] if "choose" in action)]:
        follow_up = next(
            action["data"] for action in completion["choose"][0]["sequence"]
            if action.get("action") == "ha_notifications.send"
        )
        assert follow_up["action"] == "notify.mobile_app_follow_up"
        assert follow_up["target"] == {"entity_id": ["notify.follow_up"]}
        assert follow_up["payload"] == {
            "title": "Follow-up title",
            "message": "{% raw %}Follow-up confirmation message{% endraw %}",
            "data": {"channel": "Confirmations"},
        }


@pytest.mark.parametrize("timeout", [900, "00:15:00", {"minutes": 15}])
def test_forget_after_is_disabled_by_default_and_opt_in(automation_alert, timeout) -> None:
    base_confirmation = {
        "enabled": True,
        "buttons": [{"id": "confirm", "label": "Confirm"}],
        "notification": {"action": "notify.mobile_app_phone"},
        "reminders": {
            "enabled": True,
            "timeout": timeout,
        },
    }
    disabled = _active_sequence(generate_automation({
        **automation_alert,
        "confirmation": base_confirmation,
    }))
    assert "timeout" not in disabled[0]["data"]["payload"]["data"]

    enabled = _active_sequence(generate_automation({
        **automation_alert,
        "confirmation": {
            **base_confirmation,
            "reminders": {**base_confirmation["reminders"], "forget_after_enabled": True},
        },
    }))
    assert enabled[0]["data"]["payload"]["data"]["timeout"] == 900


def test_generate_automation_uses_native_confirmation_reminders_and_follow_up(full_feature_alert) -> None:
    branch = _active_sequence(generate_automation(full_feature_alert))
    assert branch[0]["action"] == "ha_notifications.send"
    assert branch[0]["data"]["payload"]["data"]["actions"]
    wait = next(action for action in branch if "wait_for_trigger" in action)
    assert wait["wait_for_trigger"]
    completion = next(action for action in branch if "choose" in action)
    completion_sequence = completion["choose"][0]["sequence"]
    notification_index = next(
        index
        for index, action in enumerate(completion_sequence)
        if action.get("action") == "ha_notifications.send"
    )
    native_action_index = next(
        index
        for index, action in enumerate(completion_sequence)
        if action.get("action") == "light.turn_on"
    )
    action_executed_index = next(
        index
        for index, action in enumerate(completion_sequence)
        if action.get("action") == "ha_notifications.report"
        and action.get("data", {}).get("status") == "action_executed"
    )
    assert completion_sequence[0]["data"]["status"] == "confirmation_completed"
    assert completion_sequence[notification_index]["data"]["history_reason"] == (
        "confirmation_notification"
    )
    assert notification_index < native_action_index
    assert native_action_index < action_executed_index
    assert completion_sequence[-1] == {"stop": "confirmation completed"}
    timeout_sequence = completion["default"]
    repeat = next(action["repeat"] for action in timeout_sequence if "repeat" in action)
    assert repeat["count"] == 5
    assert repeat["sequence"][0]["action"] == "ha_notifications.send"
    repeat_completion = next(
        action for action in repeat["sequence"] if "choose" in action
    )
    assert repeat_completion["choose"][0]["sequence"] == completion["choose"][0][
        "sequence"
    ]
    assert branch[1] == {
        "action": "logbook.log",
        "data": {"name": "Full feature sent"},
    }
    assert all(
        action != branch[1]
        for action in completion["choose"][0]["sequence"]
    )


@pytest.mark.parametrize("notification_enabled", [True, False])
def test_confirmation_notification_opt_in_controls_only_follow_up_send(
    automation_alert: dict[str, object],
    notification_enabled: bool,
) -> None:
    generated = generate_automation({
        **automation_alert,
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {
                "enabled": notification_enabled,
                "action": "notify.mobile_app_phone",
                "message": "Confirmed",
            },
            "actions": [{"action": "light.turn_on"}],
        },
    })

    sequence = _active_sequence(generated)
    completion = next(action for action in sequence if "choose" in action)
    follow_up = completion["choose"][0]["sequence"]
    follow_up_sends = [
        action for action in follow_up if action.get("action") == "ha_notifications.send"
    ]

    assert follow_up[0]["action"] == "ha_notifications.report"
    assert follow_up[0]["data"]["status"] == "confirmation_completed"
    assert bool(follow_up_sends) is notification_enabled
    assert any(action.get("action") == "light.turn_on" for action in follow_up)
    action_index = next(
            index
            for index, action in enumerate(follow_up)
            if action.get("action") == "light.turn_on"
        )
    if follow_up_sends:
        assert follow_up.index(follow_up_sends[0]) < action_index
        service_data = follow_up_sends[0]["data"]
        assert service_data["payload"]["message"] == "{% raw %}Confirmed{% endraw %}"
        assert service_data["confirmation"] == {
            "device_id": "{{ wait.trigger.event.data.device_id | default('', true) }}",
            "user_id": "{{ wait.trigger.event.context.user_id | default('', true) }}",
        }
        assert not {"template_message", "confirmation_device_id", "confirmation_user_id"}.intersection(
            service_data["payload"].get("data", {})
        )
        assert service_data["history_reason"] == "confirmation_notification"
    assert all("enabled" not in action["data"] and "notification" not in action["data"] for action in follow_up_sends)
    assert follow_up[-1] == {"stop": "confirmation completed"}


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
) -> None:
    generated = generate_automation({
        **automation_alert,
        "confirmation": {
            "enabled": True,
            "buttons": [{"label": "Confirm"}],
            "notification": {"message": "Confirmed"},
        },
    })
    branch = _active_sequence(generated)
    send = branch[0]["data"]
    wait = next(action for action in branch if "wait_for_trigger" in action)

    assert send["payload"]["data"]["actions"][0]["action"].endswith("_response_1")
    assert wait["wait_for_trigger"][0]["event_data"]["action"].endswith(
        "_response_1"
    )
    completion = next(action for action in branch if "choose" in action)
    report = next(
        action
        for action in completion["choose"][0]["sequence"]
        if action.get("action") == "ha_notifications.report"
    )
    assert report["data"]["details"] == {
        "action": "confirmation_completed",
        "device_id": "{{ wait.trigger.event.data.device_id | default('', true) }}",
        "user_id": "{{ wait.trigger.event.context.user_id | default('', true) }}",
    }


def test_generate_automation_full_feature_snapshot(
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


async def test_full_feature_fixture_passes_home_assistant_validation(
    hass: HomeAssistant,
) -> None:
    fixture = Path(__file__).parent / "fixtures" / "full_feature_automation.yaml"
    generated = yaml.safe_load(fixture.read_text())

    validated = await async_validate_config(hass, {"automation": [generated]})

    assert len(validated["automation"]) == 1
    assert validated["automation"][0].validation_status is ValidationStatus.OK


def _nested_actions(value: Any) -> list[dict[str, Any]]:
    """Return every action mapping nested in a generated automation."""
    if isinstance(value, list):
        return [
            action
            for item in value
            for action in _nested_actions(item)
        ]
    if not isinstance(value, dict):
        return []
    actions = [value] if any(
        key in value for key in ("action", "repeat", "wait_for_trigger")
    ) else []
    return actions + [
        action
        for item in value.values()
        for action in _nested_actions(item)
    ]


@pytest.mark.parametrize(
    ("case", "overrides"),
    [
        ("baseline", {}),
        (
            "post_send_enabled",
            {
                "post_send_actions": {
                    "enabled": True,
                    "actions": [{"action": "logbook.log"}],
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
                    "actions": [{"action": "light.turn_on"}],
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
                    "actions": [{"action": "logbook.log"}],
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

    nested_actions = _nested_actions(generated["actions"])
    repeat_actions = [
        action
        for action in nested_actions
        if "repeat" in action and isinstance(action["repeat"], dict)
    ]
    if case == "confirmation_with_bounded_repeat":
        assert len(repeat_actions) == 1
        assert repeat_actions[0]["repeat"]["count"] == 2
    else:
        assert not repeat_actions

    if case in {"confirmation_without_reminders", "confirmation_with_bounded_repeat"}:
        assert any("wait_for_trigger" in action for action in nested_actions)
    else:
        assert not any("wait_for_trigger" in action for action in nested_actions)

    if case == "post_send_enabled":
        assert any(action.get("action") == "logbook.log" for action in nested_actions)
        assert any(
            action.get("action") == "ha_notifications.report"
            and action.get("data", {}).get("status") == "action_executed"
            for action in nested_actions
        )
    else:
        assert not any(
            action.get("action") == "logbook.log"
            for action in nested_actions
        )

    if case == "interval_and_clear":
        assert {"trigger": "time_pattern", "minutes": "/5"} in generated["triggers"]
        assert generated["actions"] == [{
            "action": "ha_notifications.clear",
            "data": {
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "flow_id": "{{ context.id }}",
                **_managed_notification(alert["notification"]),
            },
        }]
    else:
        assert _inactive_sequence(generate_automations(alert)) == [{
            "action": "ha_notifications.report",
            "data": {
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "flow_id": "{{ context.id }}",
                "status": "inactive",
                "message": "Condition inactive",
                "details": {"action": "automation_inactive"},
            },
        }]


def test_confirmation_timeout_and_retry_contract_is_native_and_bounded() -> None:
    alert = {
        "id": "bounded_confirmation",
        "monitor": {"automation_mode": "parallel", "conditions": {"startup": True}},
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
            "actions": [{"action": "light.turn_on"}],
        },
        "post_send_actions": {
            "enabled": True,
            "actions": [{"action": "logbook.log"}],
        },
    }

    generated = generate_automation(alert)
    branch = _active_sequence(generated)
    wait = next(action for action in branch if "wait_for_trigger" in action)
    outcome = next(action for action in branch if "choose" in action)
    response = next(
        option for option in outcome["choose"]
        if option["conditions"][0]["value_template"]
        == "{{ wait.trigger.id == 'confirmation' }}"
    )
    timeout = {"sequence": outcome["default"]}
    repeat = next(action for action in timeout["sequence"] if "repeat" in action)

    assert "default" not in generated["actions"][0]
    assert len(outcome["choose"]) == 2
    assert wait["timeout"] == 15
    assert wait["continue_on_timeout"] is True
    assert response["conditions"] == [{
        "condition": "template",
        "value_template": "{{ wait.trigger.id == 'confirmation' }}",
    }]
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
    assert response_sequence[0]["data"]["status"] == "confirmation_completed"
    assert notification_index < native_action_index
    assert native_action_index < action_executed_index
    assert response_sequence[-1] == {"stop": "confirmation completed"}
    assert repeat["repeat"]["count"] == 2
    assert repeat["repeat"]["sequence"][1] == {
        "action": "ha_notifications.report",
        "data": {
            "alert_id": "bounded_confirmation",
            "alert_name": "",
            "flow_id": "{{ context.parent_id or context.id }}",
            "status": "confirmation_reminder",
            "message": "Confirmation reminder sent",
            "details": {
                "action": "confirmation_reminder",
                "repeat": "{{ repeat.index }}",
            },
        },
    }
    retry_outcome = next(
        action
        for action in repeat["repeat"]["sequence"]
        if "choose" in action
    )
    assert len(retry_outcome["choose"]) == 2
    assert retry_outcome["default"] == []
    assert branch[1] == {"action": "logbook.log"}
    assert branch[1] not in response["sequence"]
    assert timeout["sequence"][-1] == {"stop": "Confirmation ended"}
    assert timeout["sequence"][-2]["data"]["status"] == "confirmation_timeout"
    assert not any(
        action.get("action") == "ha_notifications.report"
        and action.get("data", {}).get("status") == "completed"
        for action in _nested_actions(generated)
    )


def test_confirmation_reminder_count_defaults_and_rejects_nonpositive_values() -> None:
    alert = {
        "id": "default_confirmation",
        "monitor": {"automation_mode": "parallel", "conditions": {"startup": True}},
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
        generate_automation({
            **alert,
            "id": "invalid_confirmation",
            "confirmation": {
                **alert["confirmation"],
                "reminders": {"enabled": True, "max_attempts": 0},
            },
        })


def test_confirmation_action_extensions_are_assembled() -> None:
    class ExtraCompletion:
        name = "extra_completion"
        order = 25

        def compose(self, alert, confirmation):
            return _ConfirmationActionFragments(
                completion=({"action": "scene.turn_on"},)
            )

    alert = AlertConfig.model_validate({
        "id": "extended_confirmation",
        "monitor": {"conditions": {"startup": True}},
        "notification": {"action": "notify.mobile_app_phone"},
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
        },
    })

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
    generated = generate_automation(full_feature_alert)
    branch = _active_sequence(generated)
    completion = next(action for action in branch if "choose" in action)

    assert branch[1] == full_feature_alert["post_send_actions"]["actions"][0]
    assert full_feature_alert["post_send_actions"]["actions"][0] not in completion[
        "choose"
    ][0]["sequence"]


def test_automation_boundary_preserves_persisted_native_extensions() -> None:
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
            "actions": [],
            "confirmation_native": "value",
        },
        "post_send_actions": {
            "enabled": True,
            "actions": [{"action": "light.turn_on"}],
            "post_send_native": "value",
        },
    }

    validated = AlertConfig.model_validate(alert)

    assert isinstance(validated, AlertConfig)
    generated = generate_automation(alert)
    send_action = next(
        action
        for action in generated["actions"]
        if action.get("action") == "ha_notifications.send"
    )
    assert send_action["data"]["payload"]["data"]["native_notification"] == {
        "priority": "high",
    }
    assert send_action["data"]["payload"]["data"]["actions"] == [{
        "action": "ha_notifications_extended_confirmation_confirm", "title": "Confirm",
    }]
    assert "notification" not in send_action["data"]
    assert validated.notification.options == {
        "native_notification": {"priority": "high"},
    }
    assert validated.confirmation is not None
    assert validated.confirmation.notification.options == {
        "native_confirmation": {"channel": "alerts"},
    }
    assert validated.confirmation.reminders.__pydantic_extra__ == {
        "reminder_native": True,
    }
    assert validated.confirmation.__pydantic_extra__ == {
        "confirmation_native": "value",
    }


def test_generate_automation_does_not_mutate_alert_config_native_values() -> None:
    alert = AlertConfig.model_validate({
        "id": "native_values",
        "monitor": {
            "conditions": {"startup": True, "items": [{
                "condition": "template",
                "value_template": "{{ states('sensor.water') }}",
                "native_condition": {"nested": ["preserve"]},
            }]},
        },
        "notification": {
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.phone"]},
            "options": {"native_notification": {"channel": {"name": "alerts"}}},
        },
        "post_send_actions": {
            "enabled": True,
            "actions": [{
                "action": "light.turn_on",
                "data": {"brightness": 128},
                "native_action": {"preserve": True},
            }],
        },
    })
    before = alert.model_dump(mode="python")

    generated = generate_automation(alert)

    assert alert.model_dump(mode="python") == before
    assert generated["conditions"][0]["conditions"][0]["conditions"][0] == alert.monitor.conditions.items[0]
    send_action = next(
        action
        for action in _active_sequence(generated)
        if action.get("action") == "ha_notifications.send"
    )
    assert send_action["data"]["payload"]["data"]["native_notification"] == {
        "channel": {"name": "alerts"},
    }
    assert _active_sequence(generated)[-2]["native_action"] == {"preserve": True}

    expected = deepcopy(generated)
    send_action["data"]["payload"]["data"]["native_notification"]["channel"]["name"] = "changed"
    generated["conditions"][0]["conditions"][0]["conditions"][0]["native_condition"]["nested"].append("changed")
    _active_sequence(generated)[-2]["native_action"]["preserve"] = False

    assert alert.model_dump(mode="python") == before
    assert generate_automation(alert) == expected


def test_generate_automation_preserves_post_send_actions() -> None:
    alert = {
        "id": "door_open",
        "monitor": {"conditions": {"startup": True}},
        "notification": {"action": "notify.mobile_app_phone"},
        "post_send_actions": {"enabled": True, "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.hall"}}]},
    }
    sequence = _active_sequence(generate_automation(alert))
    assert sequence[-2] == alert["post_send_actions"]["actions"][0]
    assert sequence[-1]["action"] == "ha_notifications.report"
    assert sequence[-1]["data"]["status"] == "action_executed"


@pytest.mark.parametrize("clear_notification", [False, True])
async def test_explicit_inactive_companion_snapshot_and_native_validation(
    hass: HomeAssistant, automation_alert, snapshot, clear_notification: bool,
) -> None:
    native_trigger = {
        "trigger": "state", "entity_id": "binary_sensor.door",
        "from": "on", "to": "off", "id": "door_closed", "alias": "Door closed",
    }
    automation_alert["monitor"]["inactive"] = {
        "enabled": True, "items": [native_trigger],
        "clear_notification": clear_notification,
    }

    generated = generate_automations(automation_alert)

    assert len(generated) == 2
    assert generated[0] == generate_automation(automation_alert)
    companion = generated[1]
    assert companion["id"] == "ha_notifications_low_water_inactive"
    assert companion["initial_state"] is True
    assert companion["mode"] == "queued"
    assert companion["conditions"] == []
    assert companion["triggers"] == [native_trigger]
    assert companion["triggers"][0] is not native_trigger
    assert [action["action"] for action in companion["actions"]] == [
        "ha_notifications.report", "ha_notifications.command",
        *(["ha_notifications.clear"] if clear_notification else []),
    ]
    assert companion["actions"][1]["data"] == {
        "alert_id": automation_alert["id"], "command": "cancel_run",
    }
    if clear_notification:
        assert companion["actions"][2]["data"] == {
            "alert_id": automation_alert["id"],
            "alert_name": automation_alert["name"],
            "flow_id": "{{ context.parent_id or context.id }}",
            **_managed_notification(automation_alert["notification"]),
        }
    assert _render_yaml(companion) == snapshot
    validated = await async_validate_config(hass, {"automation": generated})
    assert all(
        item.validation_status is ValidationStatus.OK
        for item in validated["automation"]
    )
    assert await async_validate_alerts(hass, [automation_alert]) == generated


@pytest.mark.parametrize("enabled,items", [(False, [{"trigger": "event", "event_type": "closed"}]), (True, [])])
def test_inactive_companion_requires_enablement_and_explicit_items(
    automation_alert, enabled: bool, items: list[dict[str, Any]],
) -> None:
    automation_alert["monitor"]["inactive"] = {
        "enabled": enabled, "items": items, "clear_notification": True,
    }

    generated = generate_automations(automation_alert)

    assert generated == [generate_automation(automation_alert)]
    assert "ha_notifications.command" not in _render_yaml(generated)
    assert "ha_notifications.clear" not in _render_yaml(generated)


@pytest.mark.parametrize("triggers_enabled", [False, True])
def test_inactive_triggers_do_not_create_main_evaluation_trigger(triggers_enabled: bool) -> None:
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

    assert generate_automations(alert) == []


def test_generate_automation_requires_evaluation_trigger() -> None:
    with pytest.raises(ValueError, match="at least one evaluation trigger"):
        generate_automation({"id": "no_trigger", "notification": {"action": "notify.mobile_app_phone"}})


@pytest.mark.parametrize("mode", ["single", "restart", "queued", "parallel"])
def test_generated_automation_uses_selected_mode(automation_alert, mode) -> None:
    generated = generate_automation({
        **automation_alert,
        "monitor": {
            **automation_alert["monitor"],
            "automation_mode": mode,
            "conditions": {**automation_alert["monitor"]["conditions"], "items": []},
        },
    })

    assert generated["mode"] == mode


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["single", "restart", "queued", "parallel"])
async def test_selected_automation_modes_pass_home_assistant_validation(
    hass: HomeAssistant,
    automation_alert: dict[str, object],
    mode: str,
) -> None:
    generated = generate_automation({
        **automation_alert,
        "monitor": {
            **automation_alert["monitor"],
            "automation_mode": mode,
            "conditions": {**automation_alert["monitor"]["conditions"], "items": []},
        },
    })

    validated = await async_validate_config(hass, {"automation": [generated]})

    assert validated["automation"][0].validation_status is ValidationStatus.OK


def test_component_registry_is_deterministic_and_extensions_follow_built_ins(automation_alert) -> None:
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
    assert names == ["trigger", "condition", "send", "post_send", "confirmation", "extension"]
    generated = generate_automations(
        automation_alert,
        (Extension(),),
    )
    assert len(generated) == 1
    generated_main = generated[0]
    extension_condition = {
        "condition": "state",
        "entity_id": "binary_sensor.extension",
        "state": "on",
    }
    assert generated_main["conditions"][0]["conditions"][0]["conditions"][:2] == [
        *automation_alert["monitor"]["conditions"]["items"],
        extension_condition,
    ]
    generated = generated_main
    sequence = _active_sequence(generated)
    assert [action["action"] for action in sequence] == [
        "ha_notifications.send",
        "script.extension",
    ]


def test_renderer_preserves_native_boundaries_and_top_level_conditions(automation_alert) -> None:
    alert = {
        **automation_alert,
        "monitor": {
            "triggers": {"items": [
                {"trigger": "state", "entity_id": ["sensor.z", "sensor.a"]},
                {"trigger": "state", "entity_id": "sensor.m"},
            ]},
            "conditions": {
                "startup": True,
                "periodic": True,
                "interval": 300,
                "items": [{
                    "condition": "and",
                    "conditions": [
                        {"condition": "state", "entity_id": ["sensor.z", "sensor.a"]},
                        {"condition": "or", "conditions": [
                            {"condition": "numeric_state", "entity_id": "sensor.m"},
                        ]},
                    ],
                }],
            },
        },
    }
    expected_triggers = [
        {"trigger": "homeassistant", "event": "start"},
        {"trigger": "time_pattern", "minutes": "/5"},
        *alert["monitor"]["triggers"]["items"],
    ]
    generated = render_automation(alert, compose_automation(alert))
    assert [
        {key: value for key, value in trigger.items() if key != "id"}
        for trigger in generated["triggers"][:len(expected_triggers)]
    ] == expected_triggers
    assert generated["conditions"][0]["conditions"][0]["conditions"][0] == alert["monitor"]["conditions"]["items"][0]
    assert len(generate_automations(alert)) == 1
    assert _inactive_sequence(generated)[0]["data"] == {
        "alert_id": alert["id"],
        "alert_name": alert["name"],
        "flow_id": "{{ context.id }}",
        "status": "inactive",
        "message": "Condition inactive",
        "details": {"action": "automation_inactive"},
    }


def test_detector_reports_inactive_without_clearing_when_disabled(automation_alert) -> None:
    alert = {
        **automation_alert,
        "monitor": {
            **automation_alert["monitor"],
            "conditions": {**automation_alert["monitor"]["conditions"], "items": [{
                "condition": "state",
                "entity_id": "binary_sensor.door",
                "state": "on",
            }]},
        },
    }

    generated = generate_automations(alert)

    assert len(generated) == 1
    assert _inactive_sequence(generated[0])[0]["data"] == {
        "alert_id": alert["id"],
        "alert_name": alert["name"],
        "flow_id": "{{ context.id }}",
        "status": "inactive",
        "message": "Condition inactive",
        "details": {"action": "automation_inactive"},
    }


def test_reconcile_automation_file_is_idempotent(tmp_path: Path, automation_alert) -> None:
    path = tmp_path / AUTOMATION_FILE
    first_document = [generate_automation(automation_alert)]
    write_automation_files(path, first_document)
    first_yaml = path.read_text()
    write_automation_files(path, first_document)
    assert path.read_text() == first_yaml


def test_write_automation_files_replaces_managed_entry(
    tmp_path: Path,
    automation_alert,
) -> None:
    path = tmp_path / AUTOMATION_FILE
    first = generate_automation(automation_alert)
    write_automation_files(path, [first])

    updated = {**automation_alert, "name": "Updated"}
    write_automation_files(path, [generate_automation(updated)])

    document = yaml.safe_load(path.read_text())
    assert len(document) == 1
    assert document[0]["id"] == first["id"]
    assert document[0]["alias"] == "HA Notifications: Updated"

def test_ensure_automation_include_appends_dedicated_file(
    tmp_path: Path,
) -> None:
    path = tmp_path / "configuration.yaml"
    path.write_text("logger:\n  default: warning\n")

    assert ensure_automation_include(path)
    assert not ensure_automation_include(path)
    assert path.read_text() == (
        "logger:\n  default: warning\n"
        "automation ha_notifications: !include ha_notifications_automations.yaml\n"
    )


def test_reconcile_automation_file_persists_yaml_copy(
    tmp_path: Path,
    automation_alert,
) -> None:
    path = tmp_path / AUTOMATION_FILE

    result = [generate_automation(automation_alert)]
    write_automation_files(path, result)

    assert path.exists()
    rendered = path.read_text()
    assert yaml.safe_load(rendered) == result
    assert "  triggers:\n    - " in rendered
    assert "  actions:\n    - " in rendered
    assert "&id" not in rendered
    assert "*id" not in rendered


def test_reconcile_automation_file_replaces_dedicated_document(
    tmp_path: Path,
    automation_alert,
) -> None:
    path = tmp_path / AUTOMATION_FILE
    path.write_text(yaml.safe_dump(
        [generate_automation(automation_alert)],
        sort_keys=False,
    ))

    updated = {**automation_alert, "name": "Updated"}
    result = [generate_automation(updated)]
    write_automation_files(path, result)

    assert result == [generate_automation(updated)]
    assert yaml.safe_load(path.read_text()) == result


@pytest.mark.asyncio
async def test_async_reconcile_restores_file_when_reload_fails(
    tmp_path: Path,
    automation_alert,
    monkeypatch,
) -> None:
    path = tmp_path / AUTOMATION_FILE
    original = b"- id: user_automation\n  alias: User\n"
    path.write_bytes(original)

    class Services:
        async def async_call(self, *_args: object, **_kwargs: object) -> None:
            raise RuntimeError("reload failed")

    async def async_add_executor_job(function, *args):
        return function(*args)

    async def validate(_hass, config):
        return {
            "automation": [
                SimpleNamespace(validation_status=ValidationStatus.OK)
                for _ in config["automation"]
            ]
        }

    monkeypatch.setattr(
        "custom_components.ha_notifications.automation.async_validate_config",
        validate,
    )

    hass = SimpleNamespace(
        async_add_executor_job=async_add_executor_job,
        config=SimpleNamespace(path=lambda name: str(tmp_path / name)),
        services=Services(),
    )
    with pytest.raises(RuntimeError, match="reload failed"):
        await async_reconcile_automations(hass, [automation_alert])
    assert path.read_bytes() == original


@pytest.mark.asyncio
async def test_async_reconcile_serializes_overlapping_updates(
    hass: HomeAssistant,
    automation_alert,
) -> None:
    entered = asyncio.Event()
    release = asyncio.Event()
    reload_calls = 0

    async def hold_first_reload(_call) -> None:
        nonlocal reload_calls
        reload_calls += 1
        if reload_calls == 1:
            entered.set()
            await release.wait()

    hass.services.async_register("automation", "reload", hold_first_reload)

    first = asyncio.create_task(async_reconcile_automations(hass, [automation_alert]))
    await entered.wait()
    second = asyncio.create_task(async_reconcile_automations(hass, []))
    await asyncio.sleep(0)
    assert reload_calls == 1

    try:
        release.set()
        await asyncio.gather(first, second)
    finally:
        if not first.done():
            first.cancel()
        if not second.done():
            second.cancel()
    assert reload_calls == 2


def test_reconcile_and_status_use_canonical_alert_state(tmp_path: Path, automation_alert) -> None:
    path = tmp_path / AUTOMATION_FILE
    result = [generate_automation(automation_alert)]
    write_automation_files(path, result)
    assert result[0]["initial_state"] is True
    assert automation_status(result, automation_alert) == "managed"
