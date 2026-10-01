"""Internal domain values for HA Notifications."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .history import HistoryStore

Mapping = dict[str, Any]


@dataclass(slots=True)
class RuntimeData:
    """Runtime-owned persisted configuration for one loaded config entry."""

    config: Mapping
    automations: list[Mapping] | None = None
    history: HistoryStore | None = None
    remove_update_listener: Any | None = None