"""Keep the configuration examples in README.md valid."""

import re
from pathlib import Path

import pytest
import yaml
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.ha_notifications.automation import async_validate_alerts
from custom_components.ha_notifications.configuration import validate_config

_README = Path(__file__).resolve().parents[2] / "README.md"
_EXAMPLES = [
    yaml.safe_load(block)
    for block in re.findall(r"```yaml\n(.*?)```", _README.read_text(), re.S)
    if block.startswith("version: 1")
]


def test_readme_has_configuration_examples() -> None:
    assert len(_EXAMPLES) >= 2


@pytest.mark.parametrize("example", _EXAMPLES, ids=lambda e: e["alerts"][0]["id"])
async def test_readme_example_is_valid(hass: HomeAssistant, example: dict) -> None:
    assert await async_setup_component(hass, "automation", {})
    validated = validate_config(example)
    assert await async_validate_alerts(hass, validated["alerts"])
