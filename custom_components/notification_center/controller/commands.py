"""Home Assistant commands executed by the controller kernel."""

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
