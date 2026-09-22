from __future__ import annotations

import asyncio

import pytest

from custom_components.ha_notifications.features.alert_coordinator import (
    AlertCoordinatorFeature,
)


@pytest.mark.asyncio
async def test_same_alert_operations_are_serialized() -> None:
    active = 0
    order: list[str] = []
    entered = asyncio.Event()
    release = asyncio.Event()

    async def handle_condition():
        nonlocal active
        active += 1
        order.append("start")
        entered.set()
        await release.wait()
        order.append("end")
        active -= 1

    coordinator = AlertCoordinatorFeature(None, {}, None, None)
    first = asyncio.create_task(
        coordinator.run("alert_1", handle_condition)
    )
    await entered.wait()
    second = asyncio.create_task(
        coordinator.run("alert_1", handle_condition)
    )
    await asyncio.sleep(0)
    assert active == 1
    assert order == ["start"]
    release.set()
    await asyncio.gather(first, second)
    assert active == 0
    assert order == ["start", "end", "start", "end"]


@pytest.mark.asyncio
async def test_different_alerts_can_run_concurrently() -> None:
    entered: set[str] = set()
    release = asyncio.Event()

    async def handle_condition(alert_id):
        entered.add(alert_id)
        await release.wait()

    coordinator = AlertCoordinatorFeature(None, {}, None, None)
    tasks = [
        asyncio.create_task(
            coordinator.run(
                alert_id, lambda alert_id=alert_id: handle_condition(alert_id)
            )
        )
        for alert_id in ("alert_1", "alert_2")
    ]
    for _ in range(3):
        await asyncio.sleep(0)
    assert entered == {"alert_1", "alert_2"}
    release.set()
    await asyncio.gather(*tasks)