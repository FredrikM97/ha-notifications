"""Pure YAML/state (de)serialization - no Home Assistant import.

`controller/core.py` performs the actual file/Store reads and writes via
`ha/gateway.py`; this module only parses, validates, and formats the data.
"""

from __future__ import annotations

from typing import Any

import yaml

from ..domain.alert_schema import normalize_config

DEFAULT_CONFIG: dict[str, Any] = {"version": 1, "alerts": []}


def parse_yaml_text(text: str) -> dict[str, Any]:
    """Parse YAML text into a mapping."""

    loaded = yaml.safe_load(text)

    if loaded is None:
        loaded = {}

    if not isinstance(loaded, dict):
        raise ValueError("Notification Center YAML must contain a mapping.")

    return loaded


def dump_yaml_text(config: dict[str, Any]) -> str:
    """Format a config mapping as YAML text."""

    return yaml.safe_dump(
        config,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    )


def default_config_yaml_text() -> str:
    """Return the YAML text for a brand-new, empty configuration."""

    return dump_yaml_text(DEFAULT_CONFIG)


def normalize_and_validate_yaml(text: str) -> dict[str, Any]:
    """Parse and normalize YAML text, raising on invalid input."""

    return normalize_config(parse_yaml_text(text))


def normalize_and_dump_yaml(config: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Normalize a config mapping and format it as YAML text."""

    normalized = normalize_config(config)
    return normalized, dump_yaml_text(normalized)


def ensure_runtime_state_shape(raw: Any) -> dict[str, Any]:
    """Return a runtime-state mapping with the expected top-level shape."""

    state = raw if isinstance(raw, dict) else {}
    state.setdefault("alerts", {})
    state.setdefault("history", [])

    if not isinstance(state["alerts"], dict):
        state["alerts"] = {}

    if not isinstance(state["history"], list):
        state["history"] = []

    return state
