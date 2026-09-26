"""Feature-owned notification preview trigger route."""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import uuid4

from homeassistant.core import Event, callback
from homeassistant.util import dt as dt_util

from ..const import EVENT_ALERT_EVENT, AlertEventType, FeatureName, WorkflowSource
from ..controller.lifecycle import FeatureBase, WebsocketArgument, websocket_route
from ..domain.runtime import AlertRuntimeState, serialize_runtime
from .configuration import Alert


class NotificationPreviewFeature(FeatureBase):
    """Adapt an explicit preview request into a condition result."""

    name = "notification_preview"
    dependencies = ("conditions",)
    _preview_ttl = timedelta(minutes=10)

    def __init__(
        self,
        hass: Any,
        state: Any,
        _config_storage: Any,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()
        self._hass = hass
        self._previews: dict[str, tuple[dict[str, Any], AlertRuntimeState]] = {}
        self._event_unsub: Any = None

    async def on_setup(self) -> None:
        """Listen for confirmation events to dispose of test runtimes."""

        self._event_unsub = self._hass.bus.async_listen(
            EVENT_ALERT_EVENT, self._handle_alert_event
        )

    async def on_unload(self) -> None:
        """Release the preview event listener."""

        if self._event_unsub is not None:
            self._event_unsub()
            self._event_unsub = None

    @callback
    def _handle_alert_event(self, event: Event) -> None:
        event_data = event.data
        config = event_data.get("config", {})
        alert_id = config.get("id")
        alert = event_data.get("event", {})
        if (
            isinstance(alert_id, str)
            and alert_id.startswith("NC_PREVIEW_")
            and alert.get("type") == AlertEventType.CONFIRMED.value
        ):
            self._previews.pop(alert_id, None)

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
        runtime = AlertRuntimeState.for_alert(preview_alert)
        self._remove_expired(dt_util.utcnow())
        self._previews[runtime.config["id"]] = (preview_alert, runtime)
        await self.feature(FeatureName.CONDITIONS).condition_result_for_alert(
            runtime,
            True,
            None,
            source=WorkflowSource.TEST,
            now=dt_util.utcnow(),
        )
        return True

    @websocket_route(
        "notification_preview.runtime_mapping",
        command="preview_runtime",
        error_code="preview_runtime_failed",
        error_message="Unable to load test alert runtime.",
    )
    async def preview_runtime_mapping(self) -> list[dict[str, Any]]:
        """Return recent in-memory test alerts for the Active view."""

        self._remove_expired(dt_util.utcnow())
        return [
            {"alert": alert, "runtime": serialize_runtime(runtime)}
            for alert, runtime in self._previews.values()
        ]

    def _remove_expired(self, now: Any) -> None:
        cutoff = now - self._preview_ttl
        self._previews = {
            alert_id: (alert, runtime)
            for alert_id, (alert, runtime) in self._previews.items()
            if (
                runtime.started_at is None
                or (
                    parsed := dt_util.parse_datetime(runtime.started_at)
                ) is None
                or parsed >= cutoff
            )
        }
