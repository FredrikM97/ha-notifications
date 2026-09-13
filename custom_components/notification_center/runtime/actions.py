"""Service action execution for Notification Center alerts."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import Context, HomeAssistant
from homeassistant.util import dt as dt_util

from ..delivery import _remove_none, _render_value

_LOGGER = logging.getLogger(__name__)


class NotificationActionRunner:
    """Render and execute configured post-notification service actions."""

    def __init__(self, hass: HomeAssistant, history: Any) -> None:
        self.hass = hass
        self.history = history

    async def async_run_notification_actions(
        self,
        alert: dict[str, Any],
        context: Context | None,
        attempt: int,
    ) -> None:
        """Run actions after a notification dispatch."""

        notification = alert["notification"]
        if not notification.get("actions_enabled", False):
            return

        variables = {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "attempt": attempt,
            "context": context,
            "now": dt_util.now(),
        }

        for index, action in enumerate(notification.get("actions", []), start=1):
            try:
                service = await self._async_call_action(action, variables, context)
                await self.history.record(
                    alert,
                    "notification_action",
                    "Post-send action executed.",
                    {"attempt": attempt, "index": index, "action": service},
                )
            except Exception as err:
                _LOGGER.exception("Post-send action failed for %s", alert["id"])
                await self.history.record(
                    alert,
                    "notification_action_failed",
                    "Post-send action failed.",
                    {"attempt": attempt, "index": index, "error": str(err)},
                )

    async def async_run_confirmation_actions(
        self,
        alert: dict[str, Any],
        context: Context | None,
        confirmed_by: str,
    ) -> None:
        """Run actions after confirmation."""

        confirmation = alert["notification"].get("confirmation", {})
        if not confirmation.get("actions_enabled", False):
            return

        variables = self._confirmation_variables(alert, confirmed_by)

        for index, action in enumerate(confirmation.get("actions", []), start=1):
            try:
                service = await self._async_call_action(action, variables, context)
                await self.history.record(
                    alert,
                    "confirmation_action",
                    "Confirmation action executed.",
                    {
                        "index": index,
                        "action": service,
                    },
                )
            except Exception as err:
                _LOGGER.exception(
                    "Confirmation action failed for %s",
                    alert["id"],
                )
                await self.history.record(
                    alert,
                    "confirmation_action_failed",
                    "Confirmation action failed.",
                    {
                        "index": index,
                        "error": str(err),
                    },
                )

    async def async_run_draft_confirmation_actions(
        self,
        alert: dict[str, Any],
        context: Context | None,
        confirmed_by: str,
    ) -> None:
        """Run draft follow-up actions without writing alert history."""

        confirmation = alert["notification"].get("confirmation", {})
        if not confirmation.get("actions_enabled", False):
            return

        variables = self._confirmation_variables(alert, confirmed_by)

        for action in confirmation.get("actions", []):
            try:
                await self._async_call_action(action, variables, context)
            except Exception:
                _LOGGER.exception(
                    "Draft confirmation action failed for %s",
                    alert["id"],
                )

    async def _async_call_action(
        self,
        action: dict[str, Any],
        variables: dict[str, Any],
        context: Context | None,
    ) -> str:
        """Render and execute one Home Assistant service action."""

        service = str(
            await _render_value(self.hass, action.get("action"), variables) or ""
        )
        if not service or "." not in service:
            raise ValueError("Invalid service action.")

        target = await _render_value(self.hass, action.get("target", {}), variables)
        data = _remove_none(
            await _render_value(self.hass, action.get("data", {}), variables)
        )
        domain, service_name = service.split(".", 1)

        await self.hass.services.async_call(
            domain,
            service_name,
            service_data=data if isinstance(data, dict) else {},
            target=target if target else None,
            blocking=True,
            context=context,
        )

        return service

    @staticmethod
    def _confirmation_variables(
        alert: dict[str, Any],
        confirmed_by: str,
    ) -> dict[str, Any]:
        return {
            "alert_id": alert["id"],
            "alert_name": alert["name"],
            "alert_active": True,
            "confirmed_by": confirmed_by,
            "now": dt_util.now(),
        }