import json
from pathlib import Path

from homeassistant import config_entries

from custom_components.ha_notifications import config_flow
from tests.backend.support.test_support import load_const_and_models

const, models = load_const_and_models()


def test_ui_config_flow_is_registered():
    manifest_path = (
        Path(__file__).parents[3]
        / "custom_components"
        / "ha_notifications"
        / "manifest.json"
    )
    manifest = json.loads(manifest_path.read_text())

    assert manifest["config_flow"]
    assert (
        config_entries.HANDLERS[const.DOMAIN] is config_flow.HaNotificationsConfigFlow
    )
    assert hasattr(config_flow.HaNotificationsConfigFlow, "async_step_reconfigure")


def test_remove_callback_is_defined():
    from custom_components.ha_notifications import async_remove_entry

    assert callable(async_remove_entry)


def test_config_version_defined():
    assert const.CONFIG_VERSION == 1


def test_normalize_config_has_canonical_monitor():
    config = {
        "version": 1,
        "alerts": [
            {
                "id": "demo",
                "name": "Demo",
                "enabled": True,
                "conditions": [{"type": "template", "template": "{{ true }}"}],
                "monitor": {"on_change": True, "interval": 1800},
                "notification": {
                    "action": "notify.test",
                    "target": {"entity_id": ["notify.a"]},
                    "title": "Hi",
                    "message": "Hey",
                },
            }
        ],
    }

    normalized = models.Configuration.model_validate(config).model_dump(
        exclude_none=True
    )
    alert = normalized["alerts"][0]

    assert normalized["version"] == 1
    assert alert["monitor"]["on_change"]
    assert alert["monitor"]["interval"] == 1800
    assert "trigger" not in alert
    assert "logic" not in alert
    assert "notify_on_start" not in alert
