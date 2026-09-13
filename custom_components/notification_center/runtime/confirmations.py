"""Confirmation support helpers for Notification Center runtime flows."""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any

from homeassistant.core import Context, HomeAssistant
from homeassistant.util import dt as dt_util

from ..delivery import NotificationDispatcher, _render_value

_LOGGER = logging.getLogger(__name__)


def resolve_user(hass: HomeAssistant | None, user_id: str | None) -> str:
    """Resolve a Home Assistant user to a person name."""

    if not user_id or hass is None:
        return "Unknown user"

    for state in hass.states.async_all("person"):
        if state.attributes.get("user_id") == user_id:
            return state.name

    return "Unknown user"


class ConfirmationSupport:
    """Build and send confirmation follow-up notifications."""

    def __init__(
        self,
        hass: HomeAssistant,
        dispatcher: NotificationDispatcher,
        history: Any,
    ) -> None:
        self.hass = hass
        self.dispatcher = dispatcher
        self.history = history

    async def async_send_completion(
        self,
        alert: dict[str, Any],
        context: Context | None,
        confirmed_by: str,
        *,
        test: bool = False,
        record_history: bool = False,
    ) -> None:
        """Send a follow-up notification after confirmation when configured."""

        completion_alert = await self._build_completion_alert(
            alert,
            context,
            confirmed_by,
        )
        if completion_alert is None:
            return

        try:
            await self.dispatcher.async_send(
                completion_alert,
                attempt=1,
                confirmation_action_id=None,
                context=context,
                test=test,
            )

            if record_history:
                await self.history.record(
                    alert,
                    "completion_sent",
                    "Completion notification sent.",
                    {},
                )

        except Exception as err:
            if record_history:
                await self.history.record(
                    alert,
                    "completion_failed",
                    "Completion notification failed.",
                    {
                        "error": str(err),
                    },
                )
            else:
                _LOGGER.exception("Failed to send draft completion notification")

    async def _build_completion_alert(
        self,
        alert: dict[str, Any],
        context: Context | None,
        confirmed_by: str,
    ) -> dict[str, Any] | None:
        """Build the follow-up notification sent after a confirmation."""

        notification = alert["notification"]
        confirmation = notification.get("confirmation", {})
        completion_message = confirmation.get("completion_message") or ""

        if confirmation.get("notify_on_confirmation", False):
            completion_message = (
                confirmation.get("confirmation_message")
                or completion_message
                or "{{ confirmed_by }} confirmed this notification."
            )

        if not completion_message:
            return None

        completion_alert = deepcopy(alert)
        completion_alert["notification"] = deepcopy(notification)
        completion_alert["notification"]["message"] = await _render_value(
            self.hass,
            completion_message,
            {
                "alert_id": alert["id"],
                "alert_name": alert["name"],
                "alert_active": True,
                "confirmed_by": confirmed_by,
                "context": context,
                "now": dt_util.now(),
            },
        )
        completion_alert["notification"]["confirmation"] = {"enabled": False}

        return completion_alert