"""Tests for alert configuration and runtime transitions."""

from __future__ import annotations

import unittest

from custom_components.ha_notifications.const import STATE_RUNTIME
from custom_components.ha_notifications.features.alerts import AlertFeature
from custom_components.ha_notifications.features.configuration import Alert


async def test_disabled_runtime_reset_contract_snapshot(snapshot):
    state = {
        STATE_RUNTIME: {
            "alert_1": {
                "active": True,
                "acknowledged": False,
                "attempts": 4,
                "confirmation_action_id": "confirm_1",
                "last_notified": "2026-09-16T12:00:00+00:00",
            }
        }
    }
    feature = AlertFeature(None, state, None, None)
    feature._alerts = {
        "alert_1": Alert(id="alert_1", name="Alert", enabled=True)
    }

    await feature.apply_config(
        {"alerts": [{"id": "alert_1", "name": "Alert", "enabled": False}]}
    )

    assert feature.runtime("alert_1") == snapshot


class AlertConfigurationTests(unittest.IsolatedAsyncioTestCase):
    async def test_disabling_and_reenabling_resets_runtime_attempts(self) -> None:
        state = {
            STATE_RUNTIME: {
                "alert_1": {
                    "active": True,
                    "acknowledged": False,
                    "attempts": 4,
                    "confirmation_action_id": "confirm_1",
                    "last_notified": "2026-09-16T12:00:00+00:00",
                }
            }
        }
        feature = AlertFeature(None, state, None, None)
        feature._alerts = {
            "alert_1": Alert(id="alert_1", name="Alert", enabled=True)
        }

        await feature.apply_config(
            {"alerts": [{"id": "alert_1", "name": "Alert", "enabled": False}]}
        )

        runtime = feature.runtime("alert_1")
        self.assertEqual(runtime["attempts"], 0)
        self.assertIsNone(runtime["confirmation_action_id"])
        self.assertFalse(runtime["active"])


if __name__ == "__main__":
    unittest.main()