"""Home Assistant commands executed by the controller kernel."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Union

from .events import Event


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


@dataclass(frozen=True)
class Emit:
    """Publish an Event back onto the bus - this is how effects cascade."""

    event: Event


@dataclass(frozen=True)
class RunBatch:
    """Execute inner commands in sequence and report the outcome as events.

    On success, `on_success` (if set) is published. On the first exception,
    `on_error` (if set) is published with `{"error": str(err)}` merged into
    its payload; if `on_error` is unset the kernel logs and swallows it.
    """

    commands: list["Command"]
    on_success: Event | None = None
    on_error: Event | None = None


Command = Union[
    CallService, TrackTemplate, TrackInterval, Unsubscribe, PersistSave, Emit, RunBatch
]
