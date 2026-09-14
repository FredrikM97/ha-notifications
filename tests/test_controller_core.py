"""Golden-path integration test for controller/core.py, the kernel.

Uses a hand-built fake gateway (not the real `HomeAssistantGateway`) so this
test never touches real Home Assistant machinery - it only exercises
`controller/core.py`'s wiring between the pure modules, which is exactly
what "controller/core.py needs exactly one fake" means in practice.
"""

from __future__ import annotations

import asyncio
import importlib
import unittest
from datetime import datetime, timedelta, timezone

from test_support import PACKAGE_NAME, ensure_package

from conftest import make_alert

ensure_package()
core_module = importlib.import_module(f"{PACKAGE_NAME}.controller.core")
commands_module = importlib.import_module(f"{PACKAGE_NAME}.controller.commands")
alert_schema_module = importlib.import_module(f"{PACKAGE_NAME}.domain.alert_schema")


class FakeGateway:
    """Records every call a real gateway would make, in memory."""

    def __init__(self):
        self.service_calls: list[tuple[str, str, dict, dict | None]] = []
        self.condition_callbacks: dict[str, callable] = {}
        self.interval_callbacks: dict[str, callable] = {}
        self.store_data: dict[str, object] = {}
        self.files: dict[str, str] = {}
        self.registered_websocket_commands: list = []
        self._now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.known_services: set[tuple[str, str]] = set()

    # -- clock --
    def now_utc(self):
        return self._now

    def advance(self, delta: timedelta) -> None:
        self._now += delta

    # -- services --
    async def call_service(self, domain, service, data=None, target=None, **_kwargs):
        self.service_calls.append((domain, service, data or {}, target))

    def has_service(self, domain, service):
        return (domain, service) in self.known_services

    # -- templates --
    async def render_template(self, source, variables=None, **_kwargs):
        return source

    async def evaluate_condition(self, source):
        return True, None

    def track_template(self, source, on_result):
        key = f"template::{len(self.condition_callbacks)}"
        self.condition_callbacks[source] = on_result
        return lambda: None

    def track_interval(self, interval, on_interval):
        self.interval_callbacks[interval] = on_interval
        return lambda: None

    # -- registries --
    def entity_registry_snapshot(self):
        return type("Registry", (), {"entities": {}})()

    def device_registry_snapshot(self):
        return type("Registry", (), {"devices": {}})()

    def area_registry_snapshot(self):
        return type("Registry", (), {"areas": {}})()

    def config_entries_for_domain(self, domain):
        return []

    def get_states_all(self, domain):
        return []

    # -- event bus --
    def bus_listen(self, event_type, callback_fn):
        return lambda: None

    def bus_listen_once(self, event_type, callback_fn):
        return lambda: None

    @property
    def is_running(self):
        return True

    # -- persistence --
    def make_store(self, version, key):
        return key

    async def load_store(self, store):
        return self.store_data.get(store)

    async def save_store(self, store, data):
        self.store_data[store] = data

    def delay_save_store(self, store, data, delay=1):
        self.store_data[store] = data

    def config_path(self, *parts):
        return "/".join(parts)

    async def read_text_file(self, path):
        return self.files[str(path)]

    async def write_text_file(self, path, content):
        self.files[str(path)] = content

    async def run_in_executor(self, func, *args):
        return func(*args)

    # -- tasks --
    def create_task(self, coroutine):
        return asyncio.ensure_future(coroutine)

    # -- frontend/panel/websocket registration --
    async def register_static_path(self, url, directory):
        pass

    def register_extra_js(self, module_url):
        pass

    def panel_exists(self, frontend_url_path):
        return True

    async def register_panel(self, **kwargs):
        pass

    def unregister_panel(self, frontend_url_path):
        pass

    def register_websocket_command(self, handler):
        self.registered_websocket_commands.append(handler)


def _make_controller(gateway: FakeGateway) -> core_module.NotificationCenterController:
    controller = core_module.NotificationCenterController.__new__(
        core_module.NotificationCenterController
    )
    controller._gateway = gateway
    controller._store = gateway.make_store(1, "notification_center")
    controller._state = {"alerts": {}, "history": []}
    controller._alerts = {}
    controller._sessions = {}
    controller._condition_unsubs = {}
    controller._interval_unsubs = {}
    controller._action_event_unsub = None
    controller._started_unsub = None
    controller._tasks = set()
    controller._started = True
    controller._reload_lock = asyncio.Lock()
    return controller


def _alert(alert_id="alert_1", **overrides):
    return make_alert(alert_id, **overrides)


class SendAndClearTests(unittest.IsolatedAsyncioTestCase):
    async def test_condition_became_active_sends_notification(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert()
        controller._alerts[alert["id"]] = alert

        await controller._on_condition_result(alert["id"], True, None, source="change")

        self.assertEqual(len(gateway.service_calls), 1)
        domain, service, data, _target = gateway.service_calls[0]
        self.assertEqual((domain, service), ("notify", "send_message"))
        self.assertEqual(data["message"], "Message")

        state = controller._state["alerts"][alert["id"]]
        self.assertTrue(state["active"])
        self.assertEqual(state["attempts"], 1)

        history = controller._state["history"]
        types = [event["type"] for event in history]
        self.assertIn(core_module.HistoryEventType.CONDITION_ACTIVE, types)
        self.assertIn(core_module.HistoryEventType.NOTIFICATION_SENT, types)

    async def test_condition_became_inactive_clears_and_records_history(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert()
        controller._alerts[alert["id"]] = alert

        await controller._on_condition_result(alert["id"], True, None, source="change")
        gateway.service_calls.clear()

        await controller._on_condition_result(alert["id"], False, None, source="change")

        state = controller._state["alerts"][alert["id"]]
        self.assertFalse(state["active"])
        types = [event["type"] for event in controller._state["history"]]
        self.assertIn(core_module.HistoryEventType.CONDITION_INACTIVE, types)

    async def test_condition_error_is_recorded_without_sending(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert()
        controller._alerts[alert["id"]] = alert

        await controller._on_condition_result(
            alert["id"], None, "boom", source="change"
        )

        self.assertEqual(gateway.service_calls, [])
        types = [event["type"] for event in controller._state["history"]]
        self.assertIn(core_module.HistoryEventType.CONDITION_ERROR, types)


class ConfirmationFlowTests(unittest.IsolatedAsyncioTestCase):
    async def test_full_confirmation_flow(self):
        gateway = FakeGateway()
        gateway.known_services.add(("notify", "mobile_app_phone"))
        controller = _make_controller(gateway)

        alert = _alert(
            notification={
                "action": "notify.mobile_app_phone",
                "target": {},
                "title": "T",
                "message": "M",
                "confirmation": {
                    "enabled": True,
                    "button": "Ack",
                    "clear_on_confirmation": True,
                },
            }
        )
        controller._alerts[alert["id"]] = alert

        await controller._on_condition_result(alert["id"], True, None, source="change")

        state = controller._state["alerts"][alert["id"]]
        action_id = state["confirmation_action_id"]
        self.assertIsNotNone(action_id)
        self.assertIn(action_id, controller._sessions)

        class FakeEvent:
            data = {"action": action_id}

            class context:
                user_id = None

        await controller._on_action_event(FakeEvent())

        state = controller._state["alerts"][alert["id"]]
        self.assertTrue(state["acknowledged"])
        self.assertIsNone(state["confirmation_action_id"])
        self.assertNotIn(action_id, controller._sessions)

        types = [event["type"] for event in controller._state["history"]]
        self.assertIn(core_module.HistoryEventType.CONFIRMED, types)


class DraftPayloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_test_alert_payload_then_discard(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        # core.py no longer re-normalizes; simulate what bridge/websocket.py
        # would have already done to a frontend-originated payload.
        alert = alert_schema_module.DEFAULT_CONFIG_NORMALIZER.normalize_alert_document(
            _alert()
        )

        result = await controller.test_alert_payload(alert)
        session_id = result["session_id"]
        self.assertIn(session_id, controller._sessions)
        self.assertEqual(len(gateway.service_calls), 1)

        await controller.discard_test_payload(session_id)
        self.assertNotIn(session_id, controller._sessions)


class YamlSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_yaml_never_overwrites_saved_config(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        path = "notification_center.yaml"
        gateway.files[path] = "alerts: []\nversion: 1\n"

        with self.assertRaises(ValueError):
            await controller.save_yaml("- not a mapping\n")

        self.assertEqual(gateway.files[path], "alerts: []\nversion: 1\n")


if __name__ == "__main__":
    unittest.main()
