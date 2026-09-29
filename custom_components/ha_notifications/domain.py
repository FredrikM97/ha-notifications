"""Internal domain values for HA Notifications."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .history import HistoryStore

Mapping = dict[str, Any]


@dataclass(slots=True)
class AutomationRunTracker:
    """Track generated automation runs without controlling their execution."""

    active: dict[str, set[str]]
    phases: dict[str, dict[str, str]]
    uncertain: set[str]

    @classmethod
    def create(cls) -> "AutomationRunTracker":
        return cls(active={}, phases={}, uncertain=set())

    def started(self, alert_id: str, run_id: str) -> None:
        self.active.setdefault(alert_id, set()).add(run_id)
        self.phases.setdefault(alert_id, {})[run_id] = "running"

    def phase(self, alert_id: str, run_id: str, phase: str) -> None:
        """Update the observable phase of an active automation run."""
        if run_id in self.active.get(alert_id, set()):
            self.phases.setdefault(alert_id, {})[run_id] = phase

    def completed(self, alert_id: str, run_id: str) -> None:
        runs = self.active.get(alert_id)
        if runs is None:
            self.uncertain.add(alert_id)
            return
        runs.discard(run_id)
        self.phases.get(alert_id, {}).pop(run_id, None)
        if not runs:
            self.active.pop(alert_id, None)
            self.phases.pop(alert_id, None)

    def cleared(self, alert_id: str) -> None:
        """Forget runs canceled when an inactive condition clears an alert."""
        self.active.pop(alert_id, None)
        self.phases.pop(alert_id, None)
        self.uncertain.discard(alert_id)

    def status(self, alert_id: str) -> dict[str, Any]:
        phases = self.phases.get(alert_id, {})
        return {
            "active_runs": len(self.active.get(alert_id, set())),
            "active_runs_waiting": sum(phase == "waiting" for phase in phases.values()),
            "active_runs_running": sum(phase == "running" for phase in phases.values()),
            "active_runs_uncertain": alert_id in self.uncertain,
        }


@dataclass(slots=True)
class RuntimeData:
    """Runtime-owned persisted configuration for one loaded config entry."""

    config: Mapping
    automations: list[Mapping] | None = None
    history: HistoryStore | None = None
    automation_runs: AutomationRunTracker | None = None
    remove_update_listener: Any | None = None