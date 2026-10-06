"""Keep the README's minimal usage snippet and documentation links valid."""

import re
from pathlib import Path

import pytest
import yaml

_README = Path(__file__).resolve().parents[2] / "README.md"
_CONTENT = _README.read_text()


def test_readme_has_only_the_dashboard_card_snippet() -> None:
    examples = [
        yaml.safe_load(block)
        for block in re.findall(r"```yaml\n(.*?)```", _CONTENT, re.S)
    ]
    assert examples == [{"type": "custom:ha-notifications-card"}]
    assert "Configuration Example" not in _CONTENT


@pytest.mark.parametrize("target", ["docs/automation-flow.md", "docs/development.md"])
def test_readme_links_to_existing_documentation(target: str) -> None:
    assert target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", _CONTENT)
    assert (_README.parent / target).is_file()
