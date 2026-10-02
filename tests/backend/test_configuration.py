"""Tests for the canonical configuration contract."""

import pytest
from pydantic import ValidationError

from custom_components.ha_notifications import RuntimeData, async_save_config
from custom_components.ha_notifications.config_flow import HaNotificationsConfigFlow
from custom_components.ha_notifications.configuration import (
    Configuration,
    validate_config,
)


def test_validate_config_preserves_canonical_monitor_conditions_and_notification() -> None:
    config = validate_config({"alerts": [{
        "id": "low_water",
            "triggers": [{"trigger": "state", "entity_id": "sensor.water"}],
        "conditions": [{"condition": "state", "entity_id": "sensor.water", "state": "low"}],
        "notification": {
            "action": "notify.mobile_app_phone",
            "target": {"entity_id": ["notify.phone"]},
            "message": "Low water",
        },
    }]})
    alert = config["alerts"][0]
    assert config["version"] == 1
    assert alert["triggers"] == [{"trigger": "state", "entity_id": "sensor.water"}]
    assert alert["conditions"][0]["entity_id"] == "sensor.water"
    assert alert["notification"]["target"] == {"entity_id": ["notify.phone"]}
    assert alert["automation_mode"] == "parallel"


def test_validate_config_preserves_cancel_on_inactive_opt_in() -> None:
    config = validate_config({"alerts": [{
        "id": "quiet_alert",
        "cancel_on_inactive": True,
        "notification": {"action": "notify.mobile_app_phone"},
    }]})

    assert config["alerts"][0]["cancel_on_inactive"] is True


def test_validate_config_preserves_condition_change_trigger_opt_in() -> None:
    config = validate_config({"alerts": [{
        "id": "condition_alert",
        "on_condition_change": True,
        "notification": {"action": "notify.mobile_app_phone"},
    }]})

    assert config["alerts"][0]["on_condition_change"] is True


def test_validate_config_discards_retired_clear_on_inactive_option() -> None:
    config = validate_config({"alerts": [{
        "id": "legacy_alert",
        "clear_on_inactive": True,
        "notification": {"action": "notify.mobile_app_phone"},
    }]})

    assert "clear_on_inactive" not in config["alerts"][0]


@pytest.mark.parametrize("mode", ["single", "restart", "queued", "parallel"])
def test_validate_config_accepts_automation_modes(mode: str) -> None:
    config = validate_config({"alerts": [{
        "id": "mode_alert",
        "automation_mode": mode,
        "notification": {"action": "notify.mobile_app_phone"},
    }]})

    assert config["alerts"][0]["automation_mode"] == mode


def test_validate_config_rejects_unknown_automation_mode() -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{
            "id": "mode_alert",
            "automation_mode": "restart_and_parallel",
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
            "triggers": ["not a mapping"],
            "notification": {"action": "notify.mobile_app_phone"},
        }]})


def test_validate_config_accepts_confirmation_and_post_send_actions() -> None:
    config = validate_config({"alerts": [{
        "id": "confirm_alert",
            "triggers": [{"trigger": "homeassistant", "event": "start"}],
        "conditions": [],
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
        "message": "Confirmed",
    }


def test_validate_config_rejects_nonpositive_confirmation_attempts() -> None:
    with pytest.raises(ValidationError):
        validate_config({"alerts": [{
            "id": "confirm_alert",
            "monitor": {"startup": True},
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
                "notification_native": {"priority": "high"},
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
                    "confirmation_native": {"channel": "alerts"},
                },
                "reminders": {
                    "enabled": True,
                    "reminder_native": True,
                },
                "confirmation_native": "value",
            },
        }]}

    alert = Configuration.model_validate(raw).alerts[0]

    assert alert.notification.__pydantic_extra__ == {
        "notification_native": {"priority": "high"},
    }
    assert alert.confirmation is not None
    assert alert.confirmation.buttons[0].__pydantic_extra__ == {
        "button_native": "value",
    }
    assert alert.confirmation.notification.__pydantic_extra__ == {
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
