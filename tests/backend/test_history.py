"""History persistence and retention through Home Assistant's storage fixtures."""

from datetime import UTC, datetime, timedelta

import pytest
from pytest_homeassistant.common import async_fire_time_changed
from syrupy.matchers import path_type

from custom_components.ha_notifications.history import HistoryStore

_STORAGE_KEY = "ha_notifications.history"
_HISTORY_MATCHER = path_type(
    {r".*\.event\.event_id": (str,)},
    regex=True,
    replacer=lambda data, match: "<event-id>",
)


async def test_history_batches_writes_and_survives_recreation(
    hass, hass_storage, freezer, snapshot
) -> None:
    start = datetime(2026, 11, 5, 12, tzinfo=UTC)
    freezer.move_to(start)
    history = HistoryStore(hass)
    await history.async_record("door", "Door", "started", "Started", flow_id="run-1")
    await history.async_record(
        "water", "Water", "notification_sent", "Sent", {"service": "notify.phone"}
    )
    expected = await history.async_entries()
    assert _STORAGE_KEY not in hass_storage

    async_fire_time_changed(hass, start + timedelta(milliseconds=100))
    await hass.async_block_till_done()
    assert _STORAGE_KEY not in hass_storage

    async_fire_time_changed(hass, start + timedelta(seconds=1))
    freezer.move_to(start + timedelta(seconds=1))
    await hass.async_block_till_done()
    assert hass_storage[_STORAGE_KEY]["data"] == {"entries": expected}
    assert hass_storage[_STORAGE_KEY] == snapshot(matcher=_HISTORY_MATCHER)

    restored = HistoryStore(hass)
    assert await restored.async_entries() == expected
    assert await restored.async_entries("door") == [expected[1]]
    assert await restored.async_entries("missing") == []


async def test_history_flushes_pending_write_on_home_assistant_stop(
    hass, hass_storage, freezer, snapshot
) -> None:
    freezer.move_to("2026-11-05T12:00:00+00:00")
    history = HistoryStore(hass)
    await history.async_record("door", "Door", "started", "Started")
    expected = await history.async_entries()
    assert _STORAGE_KEY not in hass_storage

    await hass.async_stop(force=True)

    assert hass_storage[_STORAGE_KEY]["data"] == {"entries": expected}
    assert hass_storage[_STORAGE_KEY] == snapshot(matcher=_HISTORY_MATCHER)
    assert await HistoryStore(hass).async_entries() == expected


@pytest.mark.parametrize(
    ("age", "retained"),
    [
        (timedelta(days=30) - timedelta(seconds=1), True),
        (timedelta(days=30), True),
        (timedelta(days=30, seconds=1), False),
    ],
    ids=["before-cutoff", "at-cutoff", "after-cutoff"],
)
async def test_history_retention_boundary(hass, hass_storage, freezer, age, retained) -> None:
    now = datetime(2026, 11, 5, 12, tzinfo=UTC)
    freezer.move_to(now)
    entry = {
        "config": {"id": "door", "name": "Door"},
        "event": {"type": "started", "timestamp": (now - age).isoformat()},
    }
    hass_storage[_STORAGE_KEY] = {"version": 1, "data": {"entries": [entry]}}

    assert await HistoryStore(hass).async_entries() == ([entry] if retained else [])


async def test_history_keeps_only_500_newest_entries(hass, hass_storage, freezer) -> None:
    now = datetime(2026, 11, 5, 12, tzinfo=UTC)
    freezer.move_to(now)
    entries = [
        {
            "config": {"id": f"alert-{index}"},
            "event": {
                "type": "started",
                "timestamp": (now - timedelta(seconds=index)).isoformat(),
            },
        }
        for index in range(501)
    ]
    hass_storage[_STORAGE_KEY] = {"version": 1, "data": {"entries": entries}}
    history = HistoryStore(hass)
    assert await history.async_entries() == entries[:500]

    await history.async_record("new", "New", "started", "Started")
    retained = await history.async_entries()
    assert len(retained) == 500
    assert retained[0]["config"]["id"] == "new"
    assert retained[1:] == entries[:499]


async def test_inactive_deduplication_survives_recreation(
    hass, hass_storage, freezer, snapshot
) -> None:
    now = datetime(2026, 11, 5, 12, tzinfo=UTC)
    freezer.move_to(now)
    history = HistoryStore(hass)
    await history.async_record("door", "Door", "started", "Started", flow_id="run-1")
    assert await history.async_record_inactive("door", "Door", "Inactive", flow_id="run-1")
    async_fire_time_changed(hass, now + timedelta(seconds=1))
    freezer.move_to(now + timedelta(seconds=1))
    await hass.async_block_till_done()

    restored = HistoryStore(hass)
    assert not await restored.async_record_inactive("door", "Door", "Inactive", flow_id="run-1")
    assert len(await restored.async_entries()) == 2
    await restored.async_record("door", "Door", "started", "Started", flow_id="run-2")
    assert await restored.async_record_inactive("door", "Door", "Inactive", flow_id="run-2")
    assert len(await restored.async_entries()) == 4
    assert await restored.async_entries() == snapshot(matcher=_HISTORY_MATCHER)
