"""Shared pytest fixtures/helpers for the Notification Center test suite.

Only holds helpers that are genuinely identical across files. Suite-specific
alert shapes (e.g. `test_controller_notifications.py`'s smaller alert, which
omits `monitor`/`conditions`/`enabled` on purpose) stay local rather than
being forced through here.
"""

from __future__ import annotations

from typing import Any


def make_alert(alert_id: str = "alert_1", **overrides: Any) -> dict[str, Any]:
    """Build a full alert dict for controller/alerts.py and controller/core.py tests."""

    base = {
        "id": alert_id,
        "name": "Test alert",
        "enabled": True,
        "conditions": [{"type": "template", "template": "{{ true }}"}],
        "monitor": {"on_change": True, "startup": True},
        "notification": {
            "action": "notify.send_message",
            "target": {},
            "title": "Title",
            "message": "Message",
            "confirmation": {"enabled": False},
        },
    }
    base.update(overrides)
    return base
