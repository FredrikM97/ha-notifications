"""Tests for pure alert history querying (history.py)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_notifications.const import DOMAIN
from custom_components.ha_notifications.support.storage import Storage
from tests.backend.support.test_support import PACKAGE_NAME, load_const_and_models

load_const_and_models()
history = __import__(f"{PACKAGE_NAME}.features.history", fromlist=["history"])


def test_append_trims_to_max_history():
    entries: list[dict] = []
    for index in range(501):
        entry = {"details": {"index": index}}
        entries = history.append_entry(entries, entry)

    assert len(entries) == 500
    assert entries[-1]["details"]["index"] == 500

def test_list_entries_filters_by_alert_newest_first():
    entries: list[dict] = []
    for index in range(5):
        entry = {
            "config": {"id": "first" if index % 2 == 0 else "second"},
            "event": {"details": {"index": index}},
        }
        entries = history.append_entry(entries, entry)

    first_history = history.list_entries(entries, "first", 2)
    assert [e["event"]["details"]["index"] for e in first_history] == [4, 2]

def test_list_entries_limit_zero_still_returns_newest():
    entries = [{"details": {"index": 0}}]
    result = history.list_entries(entries, limit=0)
    assert result[0]["details"]["index"] == 0

def test_remove_alert_drops_only_matching_events():
    entries = [
        {"config": {"id": "first"}},
        {"config": {"id": "second"}},
    ]
    remaining = history.remove_alert(entries, "first")
    assert all(event["config"]["id"] == "second" for event in remaining)

def test_list_entries_limits_and_retention_preserves_invalid_timestamps():
    entries = [
        {"config": {"id": "alert_1"}, "event": {"timestamp": "not-a-date"}},
        {
            "config": {"id": "alert_1"},
            "event": {"timestamp": "2026-01-01T00:00:00+00:00"},
        },
    ]

    assert history.list_entries(entries, limit=1) == [entries[1]]
    assert (
        history.prune_entries(
            entries,
            1,
            now=datetime(2026, 1, 2, tzinfo=timezone.utc),
        )
        == entries
    )

def test_prune_entries_by_alert_applies_each_retention_policy():
    entries = [
        {
            "config": {"id": "expired"},
            "event": {"timestamp": "2020-01-01T00:00:00+00:00"},
        },
        {
            "config": {"id": "kept"},
            "event": {"timestamp": "2020-01-01T00:00:00+00:00"},
        },
        {"config": {"id": "unconfigured"}, "event": {"timestamp": "not-a-date"}},
    ]

    result = history.prune_entries_by_alert(entries, {"expired": 0, "kept": None})

    assert result == [entries[1], entries[2]]


@pytest.mark.asyncio
async def test_history_feature_records_queries_and_missing_runtime(hass):
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    storage = Storage(hass, entry)
    feature = history.HistoryFeature(hass, storage)

    assert await feature.list_history(limit=1) == []
    assert await feature.list_history(limit=1) == []
