"""Home-Assistant-facing commands, the whole vocabulary the kernel executes.

Pure modules (`controller/alerts.py`, `controller/actions.py`,
`controller/notifications.py`) return lists of these dataclasses to say
"please do this one HA-facing thing" - they never call Home Assistant
themselves. `controller/core.py` is the only place that interprets and
executes them. Keep this set closed and small: add one dataclass here and
one branch in `core.py`'s `_execute` when a genuinely new kind of
HA-facing intent is needed, never a generic "run anything" escape hatch.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Union


@dataclass(frozen=True)
class CallService:
    """Call a Home Assistant service."""

    domain: str
    service: str
    data: dict[str, Any] = field(default_factory=dict)
    target: dict[str, Any] | None = None


@dataclass(frozen=True)
class TrackTemplate:
    """Watch a Jinja condition template for an alert.

    ``key`` is the alert id; the gateway routes result callbacks back to the
    alert they belong to.
    """

    key: str
    template: str


@dataclass(frozen=True)
class TrackInterval:
    """Watch a fixed time interval for an alert."""

    key: str
    interval: timedelta


@dataclass(frozen=True)
class Unsubscribe:
    """Stop watching whatever was previously tracked under this key."""

    key: str


@dataclass(frozen=True)
class PersistSave:
    """Persist data under a storage key."""

    key: str
    data: Any


Command = Union[CallService, TrackTemplate, TrackInterval, Unsubscribe, PersistSave]
