from scripts.dev_ha import _notify_entities


def test_notify_entities_returns_sorted_unique_notify_ids() -> None:
    states = [
        {"entity_id": "sensor.temperature"},
        {"entity_id": "notify.phone"},
        {"entity_id": "notify.tablet"},
        {"entity_id": "notify.phone"},
        {"entity_id": None},
    ]

    assert _notify_entities(states) == ["notify.phone", "notify.tablet"]


def test_notify_entities_handles_unavailable_state_payload() -> None:
    assert _notify_entities(None) == []
    assert _notify_entities({"states": []}) == []