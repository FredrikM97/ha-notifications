"""Alert query routes owned by the alert feature."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from homeassistant.util import dt as dt_util

from ..const import (
    EVENT_ALERT_EVENT,
    AlertEventType,
    FeatureName,
    WorkflowSource,
)
from ..controller.lifecycle import (
    FeatureBase,
    WebsocketArgument,
    route,
    websocket_route,
)
from ..domain.runtime import AlertRuntimeState, serialize_runtime
from ..support.storage import Storage
from .configuration import Alert


class AlertFeature(FeatureBase):
    """Expose alert read routes after configuration has been applied."""

    name = "alerts"
    dependencies = ("notification", "history")

    def __init__(
        self,
        _hass: Any,
        runtime: dict[str, AlertRuntimeState],
        config_storage: Storage,
        _runtime_storage: Storage,
    ) -> None:
        super().__init__()
        self._hass = _hass
        self._runtime = runtime
        self._config_storage = config_storage
        self._alerts: dict[str, Alert] = {}

    @property
    def alerts(self) -> dict[str, Alert]:
        """The typed alert collection owned by this feature."""

        return self._alerts

    def runtime(
        self, alert_or_id: str | Mapping[str, Any]
    ) -> AlertRuntimeState:
        """Return runtime state for an ID or synchronize it from an alert."""

        if isinstance(alert_or_id, str):
            alert_id = alert_or_id
            alert = None
        else:
            alert = alert_or_id
            alert_id = str(alert["id"])
        runtime = self._runtime.get(alert_id)
        if runtime is None:
            configured = alert or self._alerts.get(alert_id)
            if configured is None:
                raise ValueError(f"Alert {alert_id} is not configured")
            runtime = AlertRuntimeState.for_alert(
                Alert.model_validate(configured).model_dump(exclude_none=True)
            )
            self._runtime[alert_id] = runtime
        elif alert is not None:
            runtime.config = Alert.model_validate(alert).model_dump(
                exclude_none=True
            )
        return runtime

    def reset_runtime(self, alert_id: str) -> None:
        """Reset toggle-scoped runtime state using the typed defaults."""

        runtime = self.runtime(alert_id)
        self._runtime[alert_id] = AlertRuntimeState.reset(runtime)

    async def deactivate(
        self,
        runtime: AlertRuntimeState,
        now: datetime,
        source: WorkflowSource,
    ) -> None:
        """Mark an active alert inactive and clear its notification if configured."""

        if not runtime.condition_active:
            runtime.trace.clear()
            return
        alert = runtime.config
        runtime.deactivate(now)
        notification = self.feature(FeatureName.NOTIFICATION)
        if notification.should_clear_on_condition_change(alert):
            await notification.clear(runtime)
        self.publish_event(
            runtime,
            AlertEventType.CONDITION_INACTIVE,
            "Condition became false.",
            {"source": source},
        )

    def activate(
        self,
        runtime: AlertRuntimeState,
        now: datetime,
        source: WorkflowSource,
    ) -> None:
        """Mark an alert active and publish its state transition."""

        if runtime.condition_active:
            return
        runtime.activate(now)
        self.publish_event(
            runtime,
            AlertEventType.CONDITION_ACTIVE,
            "Condition became true.",
            {"source": source},
        )

    def publish_event(
        self,
        runtime: AlertRuntimeState,
        event_type: AlertEventType,
        message: str,
        details: Mapping[str, Any],
    ) -> None:
        """Publish a runtime aggregate as one event fact."""

        event = {
            "event_id": uuid.uuid4().hex,
            "timestamp": dt_util.utcnow().isoformat(),
            "type": event_type.value,
            "message": message,
            "details": dict(details),
        }
        event_runtime = serialize_runtime(runtime)
        event_runtime["event"] = event
        self._hass.bus.async_fire(
            EVENT_ALERT_EVENT,
            event_runtime,
        )

    @route("alerts.apply")
    async def apply_config(self, config: dict[str, Any]) -> set[str]:
        """Replace the owned alert collection from validated configuration."""

        previous_alerts = self._alerts
        self._alerts = {
            alert["id"]: Alert.model_validate(alert) for alert in config["alerts"]
        }
        for alert in self._alerts.values():
            self.runtime(alert.model_dump(exclude_none=True))
        newly_enabled: set[str] = set()
        for alert_id in list(self._runtime):
            if alert_id not in self._alerts:
                del self._runtime[alert_id]
        for alert in self._alerts.values():
            previous = previous_alerts.get(alert.id)
            if alert.enabled and previous is not None and not previous.enabled:
                newly_enabled.add(alert.id)
            if previous is not None and alert.enabled != previous.enabled:
                self.reset_runtime(alert.id)
        return newly_enabled

    @route("alerts.get")
    async def get_alert(self, alert_id: str) -> dict[str, Any] | None:
        """Return one alert as a boundary mapping for an ordered workflow."""

        alert = self._alerts.get(alert_id)
        return alert.model_dump(exclude_none=True) if alert else None

    @route("alerts.runtime")
    async def get_runtime(self, alert_id: str) -> dict[str, Any]:
        """Return the runtime record owned by one configured alert."""

        return serialize_runtime(self.runtime(alert_id))

    @websocket_route(
        "alerts.runtime_mapping",
        command="runtime",
        error_code="runtime_failed",
        error_message="Unable to load alert runtime.",
    )
    async def get_runtime_mapping(self) -> dict[str, dict[str, Any]]:
        """Return runtime records for all configured alerts."""

        return {
            alert_id: serialize_runtime(self.runtime(alert_id))
            for alert_id in self._alerts
        }

    @websocket_route(
        "alerts.list",
        command="list",
        error_code="list_failed",
        error_message="Unable to load alerts.",
    )
    async def list_alerts(self) -> list[dict[str, Any]]:
        """Return configured alerts with their current runtime state."""

        result = []
        for alert in self._alerts.values():
            mapped = alert.model_dump(exclude_none=True)
            state = self.runtime(alert.id)
            result.append({**mapped, "runtime": serialize_runtime(state)})
        return result

    @websocket_route(
        "alerts.save",
        command="save",
        arguments=(WebsocketArgument("alert", dict),),
        error_code="save_failed",
        error_message="Unable to save alert.",
    )
    async def save_alert(self, alert: dict[str, Any]) -> dict[str, Any]:
        """Create or update an alert in ConfigEntry options."""

        config = await self._config_storage.load_config()
        alerts = list(config["alerts"])
        saved_alert = Alert.model_validate(alert).model_dump(exclude_none=True)
        now_iso = dt_util.utcnow().isoformat()
        saved_alert["updated_at"] = now_iso
        existing = next(
            (item for item in alerts if item["id"] == saved_alert["id"]), None
        )

        if existing:
            saved_alert["created_at"] = existing.get("created_at") or now_iso
            alerts = [
                saved_alert if item["id"] == saved_alert["id"] else item
                for item in alerts
            ]
        else:
            saved_alert["created_at"] = now_iso
            alerts.append(saved_alert)

        await self._config_storage.save_config({"version": 1, "alerts": alerts})
        return saved_alert

    @websocket_route(
        "alerts.delete",
        command="delete",
        arguments=(WebsocketArgument("alert_id", str),),
        error_code="delete_failed",
        error_message="Unable to delete alert.",
    )
    async def delete_alert(self, alert_id: str) -> bool:
        """Clear and remove one owned alert from ConfigEntry options."""

        alert = await self.get_alert(alert_id)
        if alert:
            await self.feature(FeatureName.NOTIFICATION).clear(
                alert
            )

        config = dict(await self._config_storage.load_config())
        config["alerts"] = [
            item for item in config["alerts"] if item["id"] != alert_id
        ]
        await self._config_storage.save_config(config)
        self._runtime.pop(alert_id, None)
        await self.feature(FeatureName.HISTORY).remove_alert(alert_id)
        return True
