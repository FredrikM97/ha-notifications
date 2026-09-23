"""Render configured follow-up actions into service-call commands."""

from __future__ import annotations

from typing import Any

from ..const import (
    AlertEventType,
    FeatureName,
)
from ..controller.lifecycle import FeatureBase
from ..domain.runtime import AlertRuntimeState
from ..domain.service_calls import FollowUpActionsRequest
from ..support.storage import Storage


class FollowUpActionsFeature(FeatureBase):
    """Own follow-up action rendering, execution, and outcome recording."""

    name = "follow_up_actions"
    dependencies = ("alerts",)

    def __init__(
        self,
        hass: Any,
        _runtime: dict[str, AlertRuntimeState],
        _config_storage: Any,
        storage: Storage,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._storage = storage

    @staticmethod
    def actions_for_confirmation(
        runtime: AlertRuntimeState,
    ) -> list[dict[str, Any]]:
        """Return raw actions configured after confirmation."""

        alert = runtime.config
        confirmation = alert.get("confirmation") or {}
        actions = confirmation.get("actions") or {}
        if not actions.get("enabled"):
            return []
        return list(actions.get("items") or [])

    async def execute(
        self,
        request: FollowUpActionsRequest,
    ) -> None:
        """Render, execute, and record post-send or confirmation actions."""

        actions = request.actions
        if not actions:
            post_send = request.runtime.config.get("post_send_actions") or {}
            if not post_send.get("enabled"):
                return
            actions = tuple(post_send.get("actions") or ())
        if not actions:
            return

        for raw_action in actions:
            error: str | None = None
            try:
                service = str(raw_action.get("action") or "")
                if not service or service.count(".") != 1:
                    raise ValueError("Invalid service action.")
                target = raw_action.get("target") or None
                data = raw_action.get("data")
                if data is None:
                    data = {}
                if not isinstance(data, dict):
                    raise ValueError("Service action data must be a mapping.")
                domain, service_name = (
                    part.strip() for part in service.split(".", 1)
                )
                if not domain or not service_name:
                    raise ValueError("Invalid service action.")
                await self._hass.services.async_call(
                    domain,
                    service_name,
                    service_data=data,
                    target=target,
                    blocking=True,
                )
                event_type = AlertEventType.NOTIFICATION_ACTION
                message = "Action executed."
            except Exception as err:  # noqa: BLE001
                event_type = AlertEventType.NOTIFICATION_ACTION_FAILED
                message = "Action failed."
                error = str(err)
            details = dict(raw_action)
            if error is not None:
                details["error"] = error
            self.feature(FeatureName.ALERTS).publish_event(
                request.runtime,
                event_type,
                message,
                details,
            )
