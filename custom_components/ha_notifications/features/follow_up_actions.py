"""Render configured follow-up actions into service-call commands."""

from __future__ import annotations

import uuid
from typing import Any

from ..const import (
    EVENT_ALERT_EVENT,
    AlertEventType,
    StateRoot,
)
from ..controller.lifecycle import FeatureBase
from ..domain.service_calls import ServiceEffectsRequest
from ..support.storage import Storage


class FollowUpActionsFeature(FeatureBase):
    """Own follow-up action rendering, execution, and outcome recording."""

    name = "follow_up_actions"

    def __init__(
        self,
        hass: Any,
        _state: StateRoot,
        _config_storage: Any,
        storage: Storage,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._storage = storage

    @staticmethod
    def actions_for_confirmation(
        alert: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Return raw actions configured after confirmation."""

        confirmation = alert.get("confirmation") or {}
        actions = confirmation.get("actions") or {}
        if not actions.get("enabled"):
            return []
        return list(actions.get("items") or [])

    async def execute(
        self,
        request: ServiceEffectsRequest,
    ) -> None:
        """Render, execute, and record post-send or confirmation actions."""

        actions = request.actions
        if not actions:
            post_send = request.alert.get("post_send_actions") or {}
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
            self._hass.bus.async_fire(
                EVENT_ALERT_EVENT,
                {
                    "id": uuid.uuid4().hex,
                    "timestamp": request.now.isoformat(),
                    "alert_id": request.alert["id"],
                    "alert_name": request.alert["name"],
                    "type": event_type.value,
                    "message": message,
                    "details": raw_action,
                    "error": error,
                },
            )
            self._storage.persist()
