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

from conftest import make_alert
from test_support import PACKAGE_NAME, ensure_package

ensure_package()
core_module = importlib.import_module(f"{PACKAGE_NAME}.controller.core")
gateway_module = importlib.import_module(f"{PACKAGE_NAME}.ha.gateway")
alert_module = importlib.import_module(f"{PACKAGE_NAME}.features.alerts")
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
        self.condition_callbacks[source] = on_result
        return lambda: self.condition_callbacks.pop(source, None)

    def track_interval(self, interval, on_interval):
        self.interval_callbacks[interval] = on_interval
        return lambda: self.interval_callbacks.pop(interval, None)

    def unsubscribe(self, key):
        self.condition_callbacks.pop(key, None)
        self.interval_callbacks.pop(key, None)

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

    # -- Home Assistant event listeners --
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
    controller._started_unsub = None
    controller._tasks = set()
    controller._started = True
    controller._reload_lock = asyncio.Lock()
    controller._triggering = core_module.alerts_module.TriggeringWorkflow(
        gateway,
        controller._alerts,
        controller._state,
        controller._handle_trigger_transition,
    )
    controller._triggering_feature = core_module.alerts_module.TriggeringFeature(
        controller._triggering
    )
    controller._confirmation_feature = core_module.responses_module.ConfirmationFeature(
        controller._sessions, controller._handle_confirmation
    )
    controller._feature_lifecycle = core_module.FeatureLifecycle(
        (controller._triggering_feature, controller._confirmation_feature)
    )
    return controller


def _alert(alert_id="alert_1", **overrides):
    return make_alert(alert_id, **overrides)


async def _condition_changed(controller, alert_id, active, error=None):
    await controller._triggering.condition_result(
        alert_id,
        active,
        error,
        source="change",
        now=controller._gateway.now_utc(),
    )


class PullBasedEvaluationTests(unittest.IsolatedAsyncioTestCase):
    async def test_reconfiguring_alert_replaces_watchers(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert()
        controller._alerts[alert["id"]] = alert

        await controller._triggering.configure(alert)
        first_template_sources = set(gateway.condition_callbacks)

        await controller._triggering.configure(alert)

        self.assertEqual(set(gateway.condition_callbacks), first_template_sources)
        self.assertEqual(len(gateway.interval_callbacks), 0)

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

    async def test_template_callback_uses_direct_triggering_workflow(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert()
        controller._alerts[alert["id"]] = alert
        await controller._triggering.configure(alert)

        callback = gateway.condition_callbacks[next(iter(gateway.condition_callbacks))]
        callback(True, None, None)
        await asyncio.sleep(0)

        self.assertTrue(controller._state["alerts"][alert["id"]]["active"])

    async def test_interval_callback_uses_direct_condition_check(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert(
            monitor={"on_change": False, "startup": True, "interval": "00:05:00"}
        )
        controller._alerts[alert["id"]] = alert
        await controller._triggering.configure(alert)

        gateway.interval_callbacks[timedelta(minutes=5)](gateway.now_utc())
        await asyncio.sleep(0)

        self.assertTrue(controller._state["alerts"][alert["id"]]["active"])


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
                    "notification": {"clear": True},
                },
            }
        )
        controller._alerts[alert["id"]] = core_module.Alert.model_validate(alert)
        controller._triggering.set_alerts({alert["id"]: alert})

        await _condition_changed(controller, alert["id"], True)

        state = controller._state["alerts"][alert["id"]]
        action_id = state["confirmation_action_id"]
        self.assertIsNotNone(action_id)
        self.assertIn(action_id, controller._sessions)

        class FakeEvent:
            data = {"action": action_id}

            class context:
                user_id = None

        await controller._confirmation_feature.setup(
            core_module.FeatureContext(
                alerts=controller._alerts,
                state=controller._state,
                gateway=gateway,
            )
        )
        await controller._confirmation_feature._on_action_event(FakeEvent())

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
        alert = _alert()

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

    async def test_reload_rebuilds_persisted_confirmation_sessions(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        alert = _alert()
        controller._alerts[alert["id"]] = core_module.Alert.model_validate(alert)
        action_id = "NC_CONFIRM_alert_1"
        controller._state["alerts"][alert["id"]] = {
            "confirmation_action_id": action_id
        }
        controller._started = False
        config, _config_text = core_module.storage_module.dump_config(
            {"version": 1, "alerts": [alert]}
        )

        async def load_config():
            return config

        controller._load_config = load_config

        await controller.reload()

        self.assertIn(action_id, controller._sessions)

    async def test_unload_cancels_tasks_and_persists_state(self):
        gateway = FakeGateway()
        controller = _make_controller(gateway)
        controller._state["history"].append({"type": "test"})
        started = asyncio.Event()

        async def pending_task():
            started.set()
            await asyncio.Event().wait()

        controller._schedule(pending_task())
        await started.wait()

        await controller.async_unload()

        self.assertEqual(controller._tasks, set())
        self.assertEqual(gateway.store_data[controller._store], controller._state)


if __name__ == "__main__":
    unittest.main()
