"""Feature-owned notification preview trigger route."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from homeassistant.util import dt as dt_util

from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from .configuration import Alert


class NotificationPreviewFeature(FeatureBase):
    """Adapt an explicit preview request into a condition result."""

    name = "notification_preview"
    dependencies = ("conditions",)

    def __init__(
        self,
        hass: Any,
        state: Any,
        _config_storage: Any,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()

    @websocket_route(
        "notification_preview.payload",
        command="preview_payload",
        arguments=(WebsocketArgument("alert", dict),),
        error_code="preview_failed",
        error_message="Unable to send test notification.",
    )
    async def preview_payload(self, alert: dict[str, Any]) -> bool:
        """Manually trigger an alert through the condition boundary."""

        preview_alert = Alert.model_validate(alert).model_dump(exclude_none=True)
        preview_alert["id"] = f"NC_PREVIEW_{uuid4().hex}"
        await self.feature("conditions").condition_result_for_alert(
            preview_alert,
            True,
            None,
            source="startup",
            now=dt_util.utcnow(),
        )
        return True
