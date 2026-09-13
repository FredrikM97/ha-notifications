"""Configuration-facing runtime operations for HA Notifications."""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any

from homeassistant.helpers.template import Template, TemplateError, result_as_boolean
from homeassistant.util import dt as dt_util

from ..delivery import _async_render_template
from ..models import compile_condition, normalize_config

_LOGGER = logging.getLogger(__name__)


class NotificationConfigAPI:
    """Handle alert config mutations and read APIs for the runtime manager."""

    def __init__(self, manager: Any) -> None:
        self.manager = manager

    async def async_save_alert(self, alert: dict[str, Any]) -> dict[str, Any]:
        """Create or update an alert."""

        config = await self.manager.storage.async_load_config()
        alerts = list(config["alerts"])
        normalized = normalize_config(
            {
                "version": 1,
                "alerts": [alert],
            }
        )["alerts"][0]

        existing = next(
            (item for item in alerts if item["id"] == normalized["id"]),
            None,
        )

        now = dt_util.utcnow().isoformat()

        if existing:
            normalized["created_at"] = existing.get("created_at") or now
            alerts = [
                normalized if item["id"] == normalized["id"] else item
                for item in alerts
            ]
        else:
            normalized["created_at"] = now
            alerts.append(normalized)

        normalized["updated_at"] = now

        await self.manager.storage.async_save_config(
            {
                "version": 1,
                "alerts": alerts,
            }
        )

        await self.manager.async_reload()

        return normalized

    async def async_delete_alert(self, alert_id: str) -> None:
        """Delete an alert."""

        alert = self.manager.alerts.get(alert_id)

        if alert:
            try:
                await self.manager.dispatcher.async_clear(alert, context=None)
            except Exception:
                _LOGGER.exception(
                    "Failed clearing notification before deleting %s",
                    alert_id,
                )

        config = await self.manager.storage.async_load_config()
        config["alerts"] = [
            alert for alert in config["alerts"] if alert["id"] != alert_id
        ]

        await self.manager.storage.async_save_config(config)

        self.manager.state["alerts"].pop(alert_id, None)
        self.manager.history.remove_alert(alert_id)

        await self.manager.async_reload()

        self.manager.storage.async_delay_save_state(self.manager.state)

    async def async_validate_yaml(self, text: str) -> dict[str, Any]:
        """Validate raw YAML without changing the saved config."""

        return await self.manager.storage.async_validate_yaml_text(text)

    async def async_validate_conditions(self, alert: dict[str, Any]) -> bool:
        """Validate and evaluate alert conditions without saving."""

        normalized = normalize_config(
            {
                "version": 1,
                "alerts": [alert],
            }
        )["alerts"][0]
        compiled = compile_condition(normalized)

        try:
            result = await _async_render_template(
                Template(compiled, self.manager.hass),
                parse_result=True,
                strict=False,
            )
        except TemplateError as err:
            raise ValueError(f"Condition template failed: {err}") from err

        result_as_boolean(result)
        return True

    async def async_save_yaml(self, text: str) -> dict[str, Any]:
        """Replace configuration using raw YAML."""

        normalized = await self.manager.storage.async_save_yaml_text(text)

        await self.manager.async_reload()
        return normalized

    async def async_get_yaml(self) -> str:
        """Return YAML."""

        return await self.manager.storage.async_load_yaml_text()

    async def async_list_alerts(self) -> list[dict[str, Any]]:
        """Return alerts with runtime information."""

        result = []

        for alert in self.manager.alerts.values():
            state = self.manager._ensure_runtime_state(alert)

            result.append(
                {
                    **deepcopy(alert),
                    "runtime": deepcopy(state),
                }
            )

        return result

    async def async_history(
        self,
        alert_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Return trace history."""

        return await self.manager.history.list(alert_id, limit)