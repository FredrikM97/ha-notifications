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
events_module = importlib.import_module(f"{PACKAGE_NAME}.controller.events")
gateway_module = importlib.import_module(f"{PACKAGE_NAME}.ha.gateway")
alert_schema_module = importlib.import_module(f"{PACKAGE_NAME}.domain.alert_schema")
const_module = importlib.import_module(f"{PACKAGE_NAME}.const")

HistoryEventType = const_module.HistoryEventType


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

    def fetch_registry_snapshot(self):
        mobile_app_entries = self.config_entries_for_domain("mobile_app")
        return gateway_module.RegistrySnapshot(
            area_registry=self.area_registry_snapshot(),
            device_registry=self.device_registry_snapshot(),
            entity_registry=self.entity_registry_snapshot(),
            mobile_app_entries=mobile_app_entries,
            mobile_app_entry_ids={entry.entry_id for entry in mobile_app_entries},
            person_states=self.get_states_all("person"),
        )

    def register_bus_responders(self, bus):
        bus.respond(events_module.RENDER_TEMPLATE, lambda _p: self._answer(self.render_template))
        bus.respond(events_module.HAS_SERVICE, lambda _p: self._answer(self.has_service))
        bus.respond(
            events_module.FETCH_REGISTRY_SNAPSHOT,
            lambda _p: self._answer(self.fetch_registry_snapshot()),
        )
        bus.respond(
            events_module.EVALUATE_CONDITION,
            lambda payload: self.evaluate_condition(payload["source"]),
        )
        bus.respond(
            events_module.GET_STATES,
            lambda payload: self._answer(self.get_states_all(payload["domain"])),
        )

    def register_bus_listeners(self, bus, store):
        async def call_service(command):
            await self.call_service(
                command.domain, command.service, command.data, command.target
            )

        async def track_template(command):
            def on_result(active, error, _event):
                self.create_task(
                    bus.publish(
                        events_module.Event(
                            events_module.CONDITION_EVALUATED,
                            {
                                "alert_id": command.key,
                                "active": active,
                                "error": error,
                                "source": "change",
                                "now": self.now_utc(),
                            },
                        )
                    )
                )

            self.track_template(command.template, on_result)

        async def track_interval(command):
            def on_interval(_now):
                self.create_task(
                    bus.publish(
                        events_module.Event(
                            events_module.CONDITION_CHECK_REQUESTED,
                            {
                                "alert_id": command.key,
                                "source": "interval",
                                "now": self.now_utc(),
                            },
                        )
                    )
                )

            self.track_interval(command.interval, on_interval)

        async def unsubscribe(_command):
            return None

        async def persist(command):
            self.delay_save_store(store, command.data)

        bus.listen(commands_module.CallService, call_service)
        bus.listen(commands_module.TrackTemplate, track_template)
        bus.listen(commands_module.TrackInterval, track_interval)
        bus.listen(commands_module.Unsubscribe, unsubscribe)
        bus.listen(commands_module.PersistSave, persist)

    async def _answer(self, value):
        return value

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
    controller._action_event_unsub = None
    controller._started_unsub = None
    controller._tasks = set()
    controller._started = True
    controller._reload_lock = asyncio.Lock()
    controller._bus = core_module.EventBus()
    gateway.register_bus_responders(controller._bus)
    gateway.register_bus_listeners(controller._bus, controller._store)
    controller._register_bus_responders()
    for module in core_module._FEATURE_MODULES:
        module.register(controller._bus)
    return controller


def _alert(alert_id="alert_1", **overrides):
    return make_alert(alert_id, **overrides)


async def _condition_changed(controller, alert_id, active, error=None):
    await controller._bus.publish(
        events_module.Event(
            events_module.CONDITION_EVALUATED,
            {
                "alert_id": alert_id,
                "active": active,
                "error": error,
                "source": "change",
                "now": controller._gateway.now_utc(),
            },
        )
    )


class PullBasedEvaluationTests(unittest.IsolatedAsyncioTestCase):
    async def test_request_condition_check_goes_through_evaluate_condition_query(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert()
        controller._alerts[alert["id"]] = alert

        await controller._request_condition_check(alert["id"], source="interval")

        state = controller._state["alerts"][alert["id"]]
        self.assertTrue(state["active"])
        types = [event["type"] for event in controller._state["history"]]
        self.assertIn(HistoryEventType.CONDITION_ACTIVE, types)

    async def test_request_condition_check_ignores_unknown_alert(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)

        await controller._request_condition_check("ghost", source="interval")

        self.assertEqual(gateway.service_calls, [])
        self.assertEqual(controller._state["history"], [])

    async def test_request_condition_check_noop_before_started(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        controller._started = False
        alert = _alert()
        controller._alerts[alert["id"]] = alert

        await controller._request_condition_check(alert["id"], source="startup")

        self.assertNotIn(alert["id"], controller._state["alerts"])


class SendAndClearTests(unittest.IsolatedAsyncioTestCase):
    async def test_condition_became_active_sends_notification(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert()
        controller._alerts[alert["id"]] = alert

        await _condition_changed(controller, alert["id"], True)

        self.assertEqual(len(gateway.service_calls), 1)
        domain, service, data, _target = gateway.service_calls[0]
        self.assertEqual((domain, service), ("notify", "send_message"))
        self.assertEqual(data["message"], "Message")

        state = controller._state["alerts"][alert["id"]]
        self.assertTrue(state["active"])
        self.assertEqual(state["attempts"], 1)

        history = controller._state["history"]
        types = [event["type"] for event in history]
        self.assertIn(HistoryEventType.CONDITION_ACTIVE, types)
        self.assertIn(HistoryEventType.NOTIFICATION_SENT, types)

    async def test_condition_became_inactive_clears_and_records_history(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert()
        controller._alerts[alert["id"]] = alert

        await _condition_changed(controller, alert["id"], True)
        gateway.service_calls.clear()

        await _condition_changed(controller, alert["id"], False)

        state = controller._state["alerts"][alert["id"]]
        self.assertFalse(state["active"])
        types = [event["type"] for event in controller._state["history"]]
        self.assertIn(HistoryEventType.CONDITION_INACTIVE, types)

    async def test_condition_error_is_recorded_without_sending(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert()
        controller._alerts[alert["id"]] = alert

        await _condition_changed(controller, alert["id"], None, "boom")

        self.assertEqual(gateway.service_calls, [])
        types = [event["type"] for event in controller._state["history"]]
        self.assertIn(HistoryEventType.CONDITION_ERROR, types)


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

        await _condition_changed(controller, alert["id"], True)

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
        self.assertIn(HistoryEventType.CONFIRMED, types)


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
