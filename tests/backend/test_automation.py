"""Tests for canonical Home Assistant automation generation."""

import asyncio
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

from custom_components.ha_notifications.automation import (
    AutomationFragments,
    _ConfirmationActionFragments,
    _ConfirmationComponent,
    async_reconcile_automations,
    automation_status,
    component_registry,
    compose_automation,
    ensure_automation_include,
    generate_automation,
    render_automation,
)
from custom_components.ha_notifications.automation_storage import (
    write_automation_files,
)
from custom_components.ha_notifications.configuration import AlertConfig
from custom_components.ha_notifications.const import AUTOMATION_FILE


def _active_sequence(generated: dict[str, Any]) -> list[dict[str, Any]]:
    sequence = generated["actions"][0]["choose"][0]["sequence"]
    return [
        action
        for action in sequence
        if not (
            action.get("action") == "ha_notifications.report"
            and action.get("data", {}).get("status") in {"started", "completed"}
        )
    ]


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
    result = dict(notification)
    result.pop("action", None)
    return result


@pytest.fixture
def automation_alert() -> dict[str, object]:
    return {
        "id": "low_water",
        "name": "Low water",
        "enabled": True,
        "monitor": {"on_change": True, "startup": True},
        "conditions": [{"condition": "numeric_state", "entity_id": "sensor.water", "below": 20}],
        "notification": {
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.phone", "notify.tablet"]},
            "data": {"message": "Low water"},
        },
    }


def test_generate_automation_uses_monitor_and_active_branches(automation_alert) -> None:
    generated = generate_automation(automation_alert)
    notification = dict(automation_alert["notification"])
    notification.pop("action")
    assert generated["conditions"] == []
    assert generated["triggers"] == [
        {"trigger": "state", "entity_id": "sensor.water"},
        {"trigger": "homeassistant", "event": "start"},
    ]
    assert generated["actions"] == [{
        "choose": [{
            "conditions": automation_alert["conditions"],
            "sequence": [{
                "action": "ha_notifications.report",
                "data": {
                    "alert_id": automation_alert["id"],
                    "alert_name": automation_alert["name"],
                    "flow_id": "{{ context.parent_id or context.id }}",
                    "status": "started",
                    "run_id": "{{ context.parent_id or context.id }}",
                    "details": {"action": "automation_started"},
                },
            }, {
                "action": "ha_notifications.send",
                "data": {
                    "alert_id": automation_alert["id"],
                    "alert_name": automation_alert["name"],
                    "flow_id": "{{ context.parent_id or context.id }}",
                    **notification,
                },
            }, {
                "action": "ha_notifications.report",
                "data": {
                    "alert_id": automation_alert["id"],
                    "alert_name": automation_alert["name"],
                    "flow_id": "{{ context.parent_id or context.id }}",
                    "status": "completed",
                    "run_id": "{{ context.parent_id or context.id }}",
                    "details": {"action": "automation_completed"},
                },
            }],
        }],
        "default": [{
            "action": "ha_notifications.report",
            "data": {
                "alert_id": automation_alert["id"],
                "alert_name": automation_alert["name"],
                "flow_id": "{{ context.id }}",
                "status": "inactive",
                "message": "Condition inactive",
                "details": {"action": "automation_inactive"},
            },
        }, {
                "stop": "condition inactive",
            },
        ],
    }]


def test_generate_automation_triggers_on_template_condition_entities() -> None:
    generated = generate_automation({
        "id": "template_alert",
        "monitor": {"on_change": True},
        "conditions": [{
            "condition": "template",
            "value_template": "{{ is_state('binary_sensor.door', 'on') }}",
        }],
        "notification": {"action": "notify.mobile_app_phone"},
    })

    assert generated["triggers"] == [{
        "trigger": "template",
        "value_template": "{{ is_state('binary_sensor.door', 'on') }}",
    }]


@pytest.mark.asyncio
async def test_template_condition_trigger_passes_home_assistant_validation(
    hass: HomeAssistant,
) -> None:
    generated = generate_automation({
        "id": "template_trigger_validation",
        "monitor": {"on_change": True, "startup": True},
        "conditions": [{
            "condition": "template",
            "value_template": "{{ is_state('input_boolean.alert_button', 'on') }}",
        }],
        "notification": {"action": "notify.mobile_app_phone"},
    })

    validated = await async_validate_config(hass, {"automation": [generated]})

    assert validated["automation"][0].validation_status is ValidationStatus.OK


def test_generate_automation_disables_condition_change_trigger_without_removing_condition() -> None:
    generated = generate_automation({
        "id": "interval_only",
        "monitor": {"on_change": False, "interval": 300},
        "conditions": [{
            "condition": "state",
            "entity_id": "binary_sensor.door",
            "state": "on",
        }],
        "notification": {"action": "notify.mobile_app_phone"},
    })

    assert generated["triggers"] == [{
        "trigger": "time_pattern",
        "minutes": "/5",
    }]
    assert generated["actions"][0]["choose"][0]["conditions"] == [{
        "condition": "state",
        "entity_id": "binary_sensor.door",
        "state": "on",
    }]


def test_template_condition_uses_state_trigger_for_inactive_clear() -> None:
    generated = generate_automation({
        "id": "template_clear",
        "monitor": {
            "on_change": True,
            "clear_on_inactive": True,
        },
        "conditions": [{
            "condition": "template",
            "value_template": "{{ is_state('input_boolean.alert_button', 'on') }}",
        }],
        "notification": {"action": "notify.mobile_app_phone"},
    })

    assert generated["triggers"] == [{
        "trigger": "state",
        "entity_id": "input_boolean.alert_button",
    }]


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


def test_enabled_reminders_repeat_the_confirmation_notification(automation_alert) -> None:
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
    repeat = next(action["repeat"] for action in sequence if "repeat" in action)
    assert repeat["count"] == 2
    assert repeat["sequence"][0] == sequence[0]
    assert any("wait_for_trigger" in action for action in repeat["sequence"])
    assert any("choose" in action for action in repeat["sequence"])


def test_reminder_attempt_title_is_opt_in(automation_alert) -> None:
    generated = generate_automation({
        **automation_alert,
        "notification": {
            **automation_alert["notification"],
            "title": "Water alert",
        },
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "notification": {"action": "notify.mobile_app_phone"},
            "reminders": {
                "enabled": True,
                "max_attempts": 3,
                "show_attempts": True,
            },
        },
    })

    sequence = _active_sequence(generated)
    repeat = next(action["repeat"] for action in sequence if "repeat" in action)
    assert repeat["sequence"][0]["data"]["title"] == (
        "Water alert - Attempt {{ repeat.index + 1 }}/3"
    )


def test_forget_after_is_disabled_by_default_and_opt_in(automation_alert) -> None:
    base_confirmation = {
        "enabled": True,
        "buttons": [{"id": "confirm", "label": "Confirm"}],
        "notification": {"action": "notify.mobile_app_phone"},
        "reminders": {
            "enabled": True,
            "timeout": 900,
        },
    }
    disabled = _active_sequence(generate_automation({
        **automation_alert,
        "confirmation": base_confirmation,
    }))
    assert "timeout" not in disabled[0]["data"].get("data", {})

    enabled = _active_sequence(generate_automation({
        **automation_alert,
        "confirmation": {
            **base_confirmation,
            "reminders": {**base_confirmation["reminders"], "forget_after_enabled": True},
        },
    }))
    assert enabled[0]["data"]["data"]["timeout"] == 900


def test_generate_automation_clears_only_when_monitor_requests_it(
    automation_alert,
) -> None:
    automation_alert["monitor"]["clear_on_inactive"] = True

    generated = generate_automation(automation_alert)
    notification = dict(automation_alert["notification"])
    notification.pop("action")

    assert generated["actions"][0]["default"] == [{
        "action": "ha_notifications.clear",
        "data": {
            "alert_id": automation_alert["id"],
            "alert_name": automation_alert["name"],
                "flow_id": "{{ context.id }}",
            **notification,
        },
    }]


def test_generate_automation_uses_native_confirmation_reminders_and_follow_up(full_feature_alert) -> None:
    branch = _active_sequence(generate_automation(full_feature_alert))
    assert branch[0]["action"] == "ha_notifications.send"
    assert branch[0]["data"]["data"]["actions"]
    wait = next(action for action in branch if "wait_for_trigger" in action)
    assert wait["wait_for_trigger"]
    completion = next(action for action in branch if "choose" in action)
    assert completion["choose"][0]["sequence"] == [
        {
            "action": "ha_notifications.send",
            "data": {
                "alert_id": "full_feature",
                "alert_name": "Full feature",
                "flow_id": "{{ context.parent_id or context.id }}",
                "target": {
                    "entity_id": ["notify.mobile_app_phone"],
                },
                "data": {
                    "template_message": "{% raw %}Confirmed{% endraw %}",
                    "confirmation_device_id": (
                        "{{ wait.trigger.event.data.device_id | default('', true) }}"
                    ),
                    "confirmation_user_id": (
                        "{{ wait.trigger.event.context.user_id | default('', true) }}"
                    ),
                },
            },
        },
        {"action": "light.turn_on", "target": {"entity_id": "light.hall"}},
        {
            "action": "ha_notifications.record",
            "data": {
                "alert_id": "full_feature",
                "alert_name": "Full feature",
                "flow_id": "{{ context.parent_id or context.id }}",
                "details": {"action": "light.turn_on"},
            },
        },
        {
            "action": "ha_notifications.report",
            "data": {
                "alert_id": "full_feature",
                "alert_name": "Full feature",
                "flow_id": "{{ context.parent_id or context.id }}",
                "status": "confirmation_completed",
                "message": "Confirmation completed",
                "run_id": "{{ context.parent_id or context.id }}",
                "details": {
                    "action": "confirmation_completed",
                    "device_id": (
                        "{{ wait.trigger.event.data.device_id | default('', true) }}"
                    ),
                    "user_id": (
                        "{{ wait.trigger.event.context.user_id | default('', true) }}"
                    ),
                },
            },
        },
        {"stop": "confirmation completed"},
    ]
    repeat = next(action for action in branch if "repeat" in action)
    assert repeat["repeat"]["count"] == 5
    assert repeat["repeat"]["sequence"][0]["action"] == "ha_notifications.send"
    repeat_completion = next(
        action for action in repeat["repeat"]["sequence"] if "choose" in action
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


def test_confirmation_button_action_is_an_event_identifier(full_feature_alert) -> None:
    branch = _active_sequence(generate_automation(full_feature_alert))
    send = branch[0]["data"]
    wait = next(action for action in branch if "wait_for_trigger" in action)

    button_action = send["data"]["actions"][0]["action"]
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

    assert send["data"]["actions"][0]["action"].endswith("_response_1")
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
            "interval_and_clear",
            {
                "monitor": {
                    "on_change": True,
                    "startup": True,
                    "interval": 300,
                    "clear_on_inactive": True,
                },
            },
        ),
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
            action.get("action") == "ha_notifications.record"
            for action in nested_actions
        )
    else:
        assert not any(
            action.get("action") == "logbook.log"
            for action in nested_actions
        )

    if case == "interval_and_clear":
        assert {"trigger": "time_pattern", "minutes": "/5"} in generated["triggers"]
        assert generated["actions"][0]["default"] == [{
            "action": "ha_notifications.clear",
            "data": {
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "flow_id": "{{ context.id }}",
                **_managed_notification(alert["notification"]),
            },
        }]
    else:
        assert generated["actions"][0]["default"] == [{
            "action": "ha_notifications.report",
            "data": {
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "flow_id": "{{ context.id }}",
                "status": "inactive",
                "message": "Condition inactive",
                "details": {"action": "automation_inactive"},
            },
        }, {
            "stop": "condition inactive",
        }]


def test_confirmation_timeout_and_retry_contract_is_native_and_bounded() -> None:
    alert = {
        "id": "bounded_confirmation",
        "monitor": {"startup": True},
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

    branch = _active_sequence(generate_automation(alert))
    wait = next(action for action in branch if "wait_for_trigger" in action)
    completion = next(action for action in branch if "choose" in action)
    repeat = next(action for action in branch if "repeat" in action)

    assert wait["timeout"] == 15
    assert wait["continue_on_timeout"] is True
    assert completion["choose"][0]["conditions"] == [{
        "condition": "template",
        "value_template": "{{ wait.trigger is not none }}",
    }]
    assert completion["choose"][0]["sequence"] == [
        {
            "action": "ha_notifications.send",
            "data": {
                "alert_id": "bounded_confirmation",
                "alert_name": "",
                "flow_id": "{{ context.parent_id or context.id }}",
                "data": {
                    "template_message": "{% raw %}Confirmed{% endraw %}",
                    "confirmation_device_id": (
                        "{{ wait.trigger.event.data.device_id | default('', true) }}"
                    ),
                    "confirmation_user_id": (
                        "{{ wait.trigger.event.context.user_id | default('', true) }}"
                    ),
                },
            },
        },
        {"action": "light.turn_on"},
        {
            "action": "ha_notifications.record",
            "data": {
                "alert_id": "bounded_confirmation",
                "alert_name": "",
                "flow_id": "{{ context.parent_id or context.id }}",
                "details": {"action": "light.turn_on"},
            },
        },
        {
            "action": "ha_notifications.report",
            "data": {
                "alert_id": "bounded_confirmation",
                "alert_name": "",
                "flow_id": "{{ context.parent_id or context.id }}",
                "status": "confirmation_completed",
                "message": "Confirmation completed",
                "run_id": "{{ context.parent_id or context.id }}",
                "details": {
                    "action": "confirmation_completed",
                    "device_id": (
                        "{{ wait.trigger.event.data.device_id | default('', true) }}"
                    ),
                    "user_id": (
                        "{{ wait.trigger.event.context.user_id | default('', true) }}"
                    ),
                },
            },
        },
        {"stop": "confirmation completed"},
    ]
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
    assert branch[1] == {"action": "logbook.log"}
    assert branch[1] not in completion["choose"][0]["sequence"]


def test_confirmation_reminder_count_defaults_and_rejects_nonpositive_values() -> None:
    alert = {
        "id": "default_confirmation",
        "monitor": {"startup": True},
        "notification": {"action": "notify.mobile_app_phone"},
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
            "reminders": {"enabled": True},
        },
    }

    branch = _active_sequence(generate_automation(alert))
    repeat = next(action for action in branch if "repeat" in action)
    assert repeat["repeat"]["count"] == 5

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
                completion={"choose": [{"sequence": [{"action": "scene.turn_on"}]}]}
            )

    alert = AlertConfig.model_validate({
        "id": "extended_confirmation",
        "monitor": {"startup": True},
        "notification": {"action": "notify.mobile_app_phone"},
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm"}],
        },
    })

    generated = _ConfirmationComponent((ExtraCompletion(),)).compose(alert)

    assert {
        "choose": [{"sequence": [{"action": "scene.turn_on"}]}]
    } in generated.active_actions


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
        "monitor": {"startup": True, "clear_on_inactive": True},
        "conditions": [],
        "notification": {
            "action": "notify.mobile_app_phone",
            "native_notification": {"priority": "high"},
        },
        "confirmation": {
            "enabled": True,
            "buttons": [{"id": "confirm", "label": "Confirm", "button_native": "value"}],
            "notification": {
                "action": "notify.mobile_app_phone",
                "native_confirmation": {"channel": "alerts"},
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
    assert generated["actions"][0]["default"][0]["data"] == {
        "alert_id": alert["id"],
        "alert_name": alert["name"],
        "flow_id": "{{ context.id }}",
        **_managed_notification(alert["notification"]),
    }
    assert _active_sequence(generated)[0]["data"] == {
        "alert_id": alert["id"],
        "alert_name": alert["name"],
        "flow_id": "{{ context.parent_id or context.id }}",
        **_managed_notification(alert["notification"]),
        "data": {
            **alert["notification"].get("data", {}),
            "actions": [{
                "action": "ha_notifications_extended_confirmation_confirm",
                "title": "Confirm",
            }],
        },
    }
    assert validated.notification.__pydantic_extra__ == {
        "native_notification": {"priority": "high"},
    }
    assert validated.confirmation is not None
    assert validated.confirmation.notification.__pydantic_extra__ == {
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
        "monitor": {"startup": True, "clear_on_inactive": True},
        "conditions": [{
            "condition": "template",
            "value_template": "{{ states('sensor.water') }}",
            "native_condition": {"nested": ["preserve"]},
        }],
        "notification": {
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.phone"]},
            "data": {"nested": {"priority": "high"}},
            "native_notification": {"channel": {"name": "alerts"}},
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
    assert generated["actions"][0]["choose"][0]["conditions"] == alert.conditions
    assert generated["actions"][0]["default"][0]["data"][
        "native_notification"
    ] == {"channel": {"name": "alerts"}}
    assert _active_sequence(generated)[-2]["native_action"] == {"preserve": True}


def test_generate_automation_preserves_post_send_actions() -> None:
    alert = {
        "id": "door_open",
        "monitor": {"startup": True},
        "conditions": [],
        "notification": {"action": "notify.mobile_app_phone"},
        "post_send_actions": {"enabled": True, "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.hall"}}]},
    }
    sequence = _active_sequence(generate_automation(alert))
    assert sequence[-2] == alert["post_send_actions"]["actions"][0]
    assert sequence[-1]["action"] == "ha_notifications.record"


def test_generate_automation_requires_monitor_trigger() -> None:
    with pytest.raises(ValueError, match="at least one evaluation trigger"):
        generate_automation({"id": "no_trigger", "monitor": {"on_change": False}, "conditions": [], "notification": {"action": "notify.mobile_app_phone"}})


def test_component_registry_is_deterministic_and_extensions_follow_built_ins(automation_alert) -> None:
    class Extension:
        name = "extension"
        order = 50

        def compose(self, _alert):
            return AutomationFragments(
                active_actions=({"action": "script.extension"},),
            )

    names = [component.name for component in component_registry((Extension(),))]
    assert names == ["monitor", "condition", "send", "post_send", "confirmation", "extension"]
    generated = render_automation(
        automation_alert,
        compose_automation(automation_alert, (Extension(),)),
    )
    sequence = _active_sequence(generated)
    assert [action["action"] for action in sequence] == [
        "ha_notifications.send",
        "script.extension",
    ]


def test_renderer_preserves_native_boundaries_and_clear_branch(automation_alert) -> None:
    alert = {
        **automation_alert,
        "monitor": {
            "on_change": True,
            "startup": True,
            "interval": 300,
            "clear_on_inactive": True,
        },
        "conditions": [{
            "condition": "and",
            "conditions": [
                {"condition": "state", "entity_id": ["sensor.z", "sensor.a"]},
                {"condition": "or", "conditions": [
                    {"condition": "numeric_state", "entity_id": "sensor.m"},
                ]},
            ],
        }],
    }
    generated = render_automation(alert, compose_automation(alert))
    assert generated["triggers"] == [
        {"trigger": "state", "entity_id": "sensor.a"},
        {"trigger": "state", "entity_id": "sensor.m"},
        {"trigger": "state", "entity_id": "sensor.z"},
        {"trigger": "homeassistant", "event": "start"},
        {"trigger": "time_pattern", "minutes": "/5"},
    ]
    branch = generated["actions"][0]
    assert branch["choose"][0]["conditions"] == alert["conditions"]
    assert branch["default"] == [{
        "action": "ha_notifications.clear",
        "data": {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "flow_id": "{{ context.id }}",
            **_managed_notification(alert["notification"]),
        },
    }]


def test_renderer_reports_inactive_without_clearing_when_disabled(automation_alert) -> None:
    alert = {
        **automation_alert,
        "monitor": {"on_change": True, "clear_on_inactive": False},
        "conditions": [{
            "condition": "state",
            "entity_id": "binary_sensor.door",
            "state": "on",
        }],
    }

    branch = generate_automation(alert)["actions"][0]

    assert branch["default"] == [{
        "action": "ha_notifications.report",
        "data": {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "flow_id": "{{ context.id }}",
            "status": "inactive",
            "message": "Condition inactive",
            "details": {"action": "automation_inactive"},
        },
    }, {
        "stop": "condition inactive",
    }]


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
