"""Alert query routes owned by the alert feature."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from ..const import EVENT_RUNTIME_PERSIST_REQUESTED
from ..controller.lifecycle import (
    FeatureBase,
    WebsocketArgument,
    route,
    websocket_route,
)
from . import history
from .configuration import Alert, AlertRuntime


class AlertFeature(FeatureBase):
    """Expose alert read routes after configuration has been applied."""

    name = "alerts"
    dependencies = ("notification",)

    def __init__(self, services: Any) -> None:
        super().__init__(services)
        self._alerts: dict[str, Alert] = {}

    @property
    def alerts(self) -> dict[str, Alert]:
        """The typed alert collection owned by this feature."""

        return self._alerts

    def runtime(self, alert_id: str) -> dict[str, Any]:
        """Return the mutable runtime state for an owned alert."""

        states = self.services.state["alerts"]
        current = states.get(alert_id)
        runtime = AlertRuntime.model_validate(current or {}).model_dump()
        if current:
            current.update(runtime)
            return current
        states[alert_id] = runtime
        return runtime

    @route("alerts.apply")
    async def apply_config(self, config: dict[str, Any]) -> set[str]:
        """Replace the owned alert collection from validated configuration."""

        previous_alerts = self._alerts
        self._alerts = {
            alert["id"]: Alert.model_validate(alert) for alert in config["alerts"]
        }
        newly_enabled: set[str] = set()
        for alert_id in list(self.services.state["alerts"]):
            if alert_id not in self._alerts:
                del self.services.state["alerts"][alert_id]
        for alert in self._alerts.values():
            previous = previous_alerts.get(alert.id)
            if alert.enabled and previous is not None and not previous.enabled:
                newly_enabled.add(alert.id)
        return newly_enabled

    @route("alerts.get")
    async def get_alert(self, alert_id: str) -> dict[str, Any] | None:
        """Return one alert as a boundary mapping for an ordered workflow."""

        alert = self._alerts.get(alert_id)
        return alert.model_dump(exclude_none=True) if alert else None

    @route("alerts.runtime")
    async def get_runtime(self, alert_id: str) -> dict[str, Any]:
        """Return the runtime record owned by one configured alert."""

        return self.runtime(alert_id)

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
            result.append({**mapped, "runtime": deepcopy(state)})
        return result

    @websocket_route(
        "alerts.save",
        command="save",
        arguments=(WebsocketArgument("alert", dict),),
        error_code="save_failed",
        error_message="Unable to save alert.",
    )
    async def save_alert(self, alert: dict[str, Any]) -> dict[str, Any]:
        """Create or update an alert, then request lifecycle reload."""

        config = await self.services.configuration_storage.load()
        alerts = list(config["alerts"])
        saved_alert = Alert.model_validate(alert).model_dump(exclude_none=True)
        now_iso = self.services.gateway.now_utc().isoformat()
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

        await self.services.configuration_storage.save({"version": 1, "alerts": alerts})
        await self.lifecycle.reload()
        return saved_alert

    @websocket_route(
        "alerts.delete",
        command="delete",
        arguments=(WebsocketArgument("alert_id", str),),
        error_code="delete_failed",
        error_message="Unable to delete alert.",
    )
    async def delete_alert(self, alert_id: str) -> bool:
        """Clear, remove, and reload one owned alert."""

        alert = await self.get_alert(alert_id)
        if alert:
            await self.feature("notification").clear(
                alert, self.services.gateway.now_utc()
            )

        config = await self.services.configuration_storage.load()
        config["alerts"] = [
            item for item in config["alerts"] if item["id"] != alert_id
        ]
        await self.services.configuration_storage.save(config)
        self.services.state["alerts"].pop(alert_id, None)
        self.services.state["history"] = history.remove_alert(
            self.services.state["history"], alert_id
        )
        await self.lifecycle.reload()
        self.services.hass.bus.async_fire(EVENT_RUNTIME_PERSIST_REQUESTED)
        return True