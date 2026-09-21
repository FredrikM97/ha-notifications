"""Alert query routes owned by the alert feature."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from homeassistant.util import dt as dt_util

from ..const import (
    STATE_HISTORY,
    STATE_RUNTIME,
    StateRoot,
)
from ..controller.lifecycle import (
    FeatureBase,
    WebsocketArgument,
    route,
    websocket_route,
)
from ..support.storage import RuntimeStateStorage
from . import history
from .confirmation import clear_pending_actions
from .configuration import Alert, AlertRuntime


class AlertFeature(FeatureBase):
    """Expose alert read routes after configuration has been applied."""

    name = "alerts"
    dependencies = ("notification",)

    def __init__(
        self,
        _hass: Any,
        state: StateRoot,
        config_storage: Any,
        runtime_storage: RuntimeStateStorage,
    ) -> None:
        super().__init__()
        self._state = state
        self._config_storage = config_storage
        self._runtime_storage = runtime_storage
        self._alerts: dict[str, Alert] = {}

    @property
    def alerts(self) -> dict[str, Alert]:
        """The typed alert collection owned by this feature."""

        return self._alerts

    def runtime(self, alert_id: str) -> dict[str, Any]:
        """Return the mutable runtime state for an owned alert."""

        states = self._state[STATE_RUNTIME]
        current = states.get(alert_id)
        runtime = AlertRuntime.model_validate(current or {}).model_dump()
        if current:
            current.update(runtime)
            return current
        states[alert_id] = runtime
        return runtime

    def reset_runtime(self, alert_id: str) -> None:
        """Reset toggle-scoped runtime state using the typed defaults."""

        runtime = self.runtime(alert_id)
        preserved = {
            key: runtime.get(key)
            for key in ("last_evaluated", "last_event")
        }
        runtime.clear()
        runtime.update(AlertRuntime().model_dump())
        runtime.update(preserved)

    @route("alerts.apply")
    async def apply_config(self, config: dict[str, Any]) -> set[str]:
        """Replace the owned alert collection from validated configuration."""

        previous_alerts = self._alerts
        self._alerts = {
            alert["id"]: Alert.model_validate(alert) for alert in config["alerts"]
        }
        newly_enabled: set[str] = set()
        for alert_id in list(self._state[STATE_RUNTIME]):
            if alert_id not in self._alerts:
                del self._state[STATE_RUNTIME][alert_id]
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

        return self.runtime(alert_id)

    @websocket_route(
        "alerts.runtime_mapping",
        command="runtime",
        error_code="runtime_failed",
        error_message="Unable to load alert runtime.",
    )
    async def get_runtime_mapping(self) -> dict[str, dict[str, Any]]:
        """Return runtime records for all configured alerts."""

        return {alert_id: self.runtime(alert_id) for alert_id in self._alerts}

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
        """Create or update an alert in ConfigEntry options."""

        config = await self._config_storage.load()
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

        await self._config_storage.save({"version": 1, "alerts": alerts})
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
            await self.feature("notification").clear(
                alert, dt_util.utcnow()
            )

        config = await self._config_storage.load()
        config["alerts"] = [
            item for item in config["alerts"] if item["id"] != alert_id
        ]
        await self._config_storage.save(config)
        self._state[STATE_RUNTIME].pop(alert_id, None)
        self._state[STATE_HISTORY] = history.remove_alert(
            self._state[STATE_HISTORY], alert_id
        )
        self._runtime_storage.persist()
        return True

    def acknowledge(
        self, alert_id: str, confirmed_by: str, now: Any
    ) -> None:
        """Apply a resolved confirmation to the owned alert runtime."""

        runtime = self.runtime(alert_id)
        runtime["acknowledged"] = True
        clear_pending_actions(runtime)
        runtime["confirmed_at"] = now.isoformat()
        runtime["confirmed_by"] = confirmed_by

    def next_attempt(self, alert_id: str) -> int:
        """Return the next delivery attempt for an owned alert."""

        return int(self.runtime(alert_id).get("attempts", 0)) + 1

    def record_delivery_result(
        self,
        alert_id: str,
        attempt: int,
        now: Any,
        *,
        success: bool,
        error: str | None = None,
    ) -> None:
        """Update delivery state without exposing the mutable runtime mapping."""

        runtime = self.runtime(alert_id)
        if not success:
            runtime["last_error"] = error
            return
        runtime["attempts"] = attempt
        runtime["last_notified"] = now.isoformat()
        runtime["last_error"] = None