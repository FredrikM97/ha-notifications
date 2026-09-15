"""Lifecycle-managed task scheduling for feature-owned background work."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from typing import Any

from homeassistant.core import HomeAssistant


class TaskScheduler:
    """Track background tasks so the lifecycle can cancel them reliably."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._tasks: set[asyncio.Task[Any]] = set()

    def schedule(self, coroutine: Awaitable[Any]) -> None:
        """Schedule one feature-owned coroutine and retain its cleanup handle."""

        task = self._hass.async_create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def unload(self) -> None:
        """Cancel and await all jobs still owned by this scheduler."""

        for task in self._tasks:
            if not task.done():
                task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()