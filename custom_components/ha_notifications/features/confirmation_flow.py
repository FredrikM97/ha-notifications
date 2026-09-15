"""Order cross-feature effects after confirmation has been resolved."""

from __future__ import annotations

from typing import Any

from ..const import EVENT_RUNTIME_PERSIST_REQUESTED, HistoryEventType
from ..controller.lifecycle import FeatureBase, route
from . import confirmation, notification


class ConfirmationFlow(FeatureBase):
    """Coordinate confirmation facts without owning confirmation state."""

    name = "confirmation_flow"
    dependencies = (
        "alerts",
        "confirmation",
        "notification",
        "follow_up_actions",
        "triggering",
        "history",
    )

    @route("flows.confirmation")
    async def handle(self, result: confirmation.ConfirmationResult) -> None:
        """Apply the ordered effects required by one resolved confirmation."""

        alert = result.alert
        runtime = await self.lifecycle.dispatch("alerts.runtime", alert["id"])
        if not result.test:
            self.feature("triggering").mark_confirmed(
                runtime,
                result.confirmed_by,
                result.now,
            )
        if result.record_history:
            self.feature("history").record(
                alert,
                HistoryEventType.CONFIRMED,
                "Notification confirmed.",
                {"confirmed_by": result.confirmed_by},
                result.now,
            )

        delivery = await notification.ConfirmationDeliveryPlanner(
            alert,
            result.confirmed_by,
            result.now,
        ).build(self.services.gateway.render_template)
        if delivery.clear_notification:
            await self.feature("notification").clear(alert, result.now)
        if delivery.completion_alert is not None:
            await self._send_completion(delivery.completion_alert, result)
        confirmation_settings = confirmation.confirmation_for_alert(alert)
        follow_up_actions = []
        if confirmation_settings and confirmation_settings.actions.enabled:
            follow_up_actions = confirmation_settings.actions.items
        await self.feature("follow_up_actions").run(
            alert,
            1,
            result.now,
            result.test,
            result.record_history,
            follow_up_actions,
            result.confirmed_by,
        )
        self.services.hass.bus.async_fire(EVENT_RUNTIME_PERSIST_REQUESTED)

    async def _send_completion(
        self, completion_alert: dict[str, Any], result: confirmation.ConfirmationResult
    ) -> None:
        """Send and record the optional completion notification."""

        alert = result.alert
        try:
            await self.feature("notification").send(
                {
                    "alert": completion_alert,
                    "attempt": 1,
                    "confirmation_action_id": None,
                    "replace_existing": False,
                    "test": result.test,
                    "now": result.now,
                }
            )
            if result.record_history:
                self.feature("history").record(
                    alert,
                    HistoryEventType.COMPLETION_SENT,
                    "Completion notification sent.",
                    {},
                    result.now,
                )
        except Exception as err:
            if result.record_history:
                self.feature("history").record(
                    alert,
                    HistoryEventType.COMPLETION_FAILED,
                    "Completion notification failed.",
                    {"error": str(err)},
                    result.now,
                )