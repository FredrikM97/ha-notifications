"""Persistence for Notification Center."""

from __future__ import annotations

from copy import deepcopy
import os
from pathlib import Path
from typing import Any

import yaml

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    CONFIG_FILENAME,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .models import normalize_config


DEFAULT_YAML = """# Notification Center
#
# This file is managed by the Notification Center integration.
# You can edit it manually or use the YAML editor in the UI.
#
# No configuration.yaml entry is required.
#
# An alert can be checked:
#
#   monitor:
#     on_change: true
#     interval: "12:00:00"
#
# Both can be enabled at the same time.
#
# Notifications can target:
#
#   entity_id
#   device_id
#   area_id
#   floor_id
#   label_id
#
# Example:
#
# alerts:
#
#   - id: example
#     name: Example reminder
#     condition: "{{ is_state('binary_sensor.example', 'on') }}"
#
#     monitor:
#       on_change: true
#       interval: "01:00:00"
#
#     notification:
#       action: notify.send_message
#       target:
#         device_id:
#           - YOUR_DEVICE_ID
#       title: Example
#       message: Something needs attention.
#
version: 1
alerts: []
"""


def _read_text(path: Path) -> str:
    """Read text from disk."""
    return path.read_text(
        encoding="utf-8"
    )


def _write_text(
    path: Path,
    content: str,
) -> None:
    """Atomically write text."""

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary = path.with_suffix(
        path.suffix + ".tmp"
    )

    temporary.write_text(
        content,
        encoding="utf-8",
    )

    os.replace(
        temporary,
        path,
    )


def _parse_yaml(
    text: str,
) -> dict[str, Any]:
    """Parse YAML safely."""

    loaded = yaml.safe_load(
        text
    )

    if loaded is None:
        loaded = {}

    if not isinstance(
        loaded,
        dict,
    ):
        raise ValueError(
            "Notification Center YAML "
            "must contain a mapping."
        )

    return loaded


class NotificationStorage:
    """Notification Center storage."""

    def __init__(
        self,
        hass: HomeAssistant,
    ) -> None:
        self.hass = hass

        self.yaml_path = Path(
            hass.config.path(
                CONFIG_FILENAME
            )
        )

        self.store = Store(
            hass,
            STORAGE_VERSION,
            STORAGE_KEY,
        )

    async def async_load_config(
        self,
    ) -> dict[str, Any]:
        """Load configuration from YAML."""

        if not self.yaml_path.exists():
            await self.async_save_config(
                {
                    "version": 1,
                    "alerts": [],
                }
            )

            return {
                "version": 1,
                "alerts": [],
            }

        text = await self.hass.async_add_executor_job(
            _read_text,
            self.yaml_path,
        )

        config = _parse_yaml(
            text
        )

        return normalize_config(
            config
        )

    async def async_save_config(
        self,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        """Validate and save YAML configuration."""

        normalized = normalize_config(
            config
        )

        text = yaml.safe_dump(
            normalized,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
        )

        await self.hass.async_add_executor_job(
            _write_text,
            self.yaml_path,
            text,
        )

        return normalized

    async def async_load_yaml_text(
        self,
    ) -> str:
        """Return the raw YAML file."""

        if not self.yaml_path.exists():
            await self.async_save_config(
                {
                    "version": 1,
                    "alerts": [],
                }
            )

        return await self.hass.async_add_executor_job(
            _read_text,
            self.yaml_path,
        )

    async def async_validate_yaml_text(
        self,
        text: str,
    ) -> dict[str, Any]:
        """Validate raw YAML text without writing it."""

        config = _parse_yaml(
            text
        )

        return normalize_config(
            config
        )

    async def async_save_yaml_text(
        self,
        text: str,
    ) -> dict[str, Any]:
        """Validate and save raw YAML text."""

        normalized = await self.async_validate_yaml_text(
            text
        )

        normalized_text = yaml.safe_dump(
            normalized,
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
        )

        await self.hass.async_add_executor_job(
            _write_text,
            self.yaml_path,
            normalized_text,
        )

        return normalized

    async def async_load_state(
        self,
    ) -> dict[str, Any]:
        """Load runtime state."""

        loaded = await self.store.async_load()

        if not isinstance(
            loaded,
            dict,
        ):
            loaded = {}

        loaded.setdefault(
            "alerts",
            {},
        )

        loaded.setdefault(
            "history",
            [],
        )

        if not isinstance(
            loaded["alerts"],
            dict,
        ):
            loaded["alerts"] = {}

        if not isinstance(
            loaded["history"],
            list,
        ):
            loaded["history"] = []

        return loaded

    def async_delay_save_state(
        self,
        state: dict[str, Any],
    ) -> None:
        """Schedule a state save."""

        snapshot = deepcopy(
            state
        )

        self.store.async_delay_save(
            lambda: snapshot,
            delay=1,
        )

    async def async_save_state_now(
        self,
        state: dict[str, Any],
    ) -> None:
        """Immediately save state."""

        await self.store.async_save(
            deepcopy(state)
        )