"""Serialize alert workflows per alert while allowing cross-alert concurrency."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from ..controller.lifecycle import FeatureBase

ResultT = TypeVar("ResultT")


class AlertCoordinatorFeature(FeatureBase):
    """Own keyed runtime serialization without knowing feature workflows."""

    name = "alert_coordinator"
    dependencies = ()

    def __init__(
        self,
        _hass: Any,
        _state: Any,
        _config_storage: Any,
        _runtime_storage: Any,
    ) -> None:
        super().__init__()
        self._locks: dict[str, asyncio.Lock] = {}

    async def on_unload(self) -> None:
        """Release keyed coordination state with the feature lifecycle."""

        self._locks.clear()

    async def run(
        self,
        alert_id: str,
        operation: Callable[[], Awaitable[ResultT]],
    ) -> ResultT:
        """Run one feature-owned operation serialized by alert ID."""

        async with self._locks.setdefault(alert_id, asyncio.Lock()):
            return await operation()
