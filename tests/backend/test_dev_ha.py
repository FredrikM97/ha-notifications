import os
import subprocess
import sys
from unittest.mock import Mock, call

import pytest

from scripts import dev_ha
from scripts.dev_ha import (
    MOCK_DEVICE_NAME,
    _notify_entities,
    _with_http_port,
    ensure_mock_mobile_app,
    onboard,
)


def test_dev_instance_replaces_existing_owner(tmp_path, monkeypatch) -> None:
    lock_path = tmp_path / "dev.lock"
    monkeypatch.setattr(dev_ha, "LOCK_FILE", lock_path)
    command = (
        "import signal; from pathlib import Path; from scripts import dev_ha; "
        f"dev_ha.LOCK_FILE = Path({str(lock_path)!r}); "
        "guard = dev_ha.dev_instance(); guard.__enter__(); "
        "print('ready', flush=True); signal.pause()"
    )
    previous = subprocess.Popen([sys.executable, "-c", command], stdout=subprocess.PIPE, text=True)
    try:
        assert previous.stdout.readline().strip() == "ready"
        with dev_ha.dev_instance():
            previous.wait(timeout=5)
            assert lock_path.read_text() == str(os.getpid())
        assert lock_path.read_text() == ""
    finally:
        if previous.poll() is None:
            previous.kill()
        previous.wait()


def test_dev_instance_ignores_stale_pid_when_lock_is_free(tmp_path, monkeypatch) -> None:
    lock_path = tmp_path / "dev.lock"
    lock_path.write_text("99999999")
    monkeypatch.setattr(dev_ha, "LOCK_FILE", lock_path)
    with dev_ha.dev_instance():
        assert lock_path.read_text() == str(os.getpid())
    assert lock_path.read_text() == ""


def test_dev_instance_releases_lock_on_startup_failure(tmp_path, monkeypatch) -> None:
    lock_path = tmp_path / "dev.lock"
    monkeypatch.setattr(dev_ha, "LOCK_FILE", lock_path)
    with pytest.raises(RuntimeError, match="build failed"):
        with dev_ha.dev_instance():
            raise RuntimeError("build failed")
    with dev_ha.dev_instance():
        assert lock_path.read_text() == str(os.getpid())


def test_stop_processes_terminates_entire_groups_and_reaps_children(monkeypatch) -> None:
    kill_group = Mock()
    monkeypatch.setattr(dev_ha.os, "killpg", kill_group)
    process = Mock(pid=12345)

    dev_ha.stop_processes([process])

    assert kill_group.call_args_list == [call(12345, dev_ha.signal.SIGTERM), call(12345, dev_ha.signal.SIGKILL)]
    assert process.wait.call_args_list == [call(timeout=30), call()]


def test_prepare_config_stages_copy_without_writing_source(tmp_path, monkeypatch) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "__init__.py").write_text("original")
    config = tmp_path / "config"
    installed = config / "custom_components" / "ha_notifications"
    installed.parent.mkdir(parents=True)
    installed.symlink_to(source, target_is_directory=True)
    monkeypatch.setattr(dev_ha, "INTEGRATION", source)
    monkeypatch.setattr(dev_ha, "CONFIG", config)

    bundle = dev_ha.prepare_config(8124, False)

    assert not installed.is_symlink()
    assert (installed.parent / "__init__.py").is_file()
    assert bundle == installed / "frontend" / "panel.js"
    assert bundle.parent.is_dir()
    assert not (source / "frontend").exists()
    (installed / "__init__.py").write_text("staged change")
    assert (source / "__init__.py").read_text() == "original"
    dev_ha.prepare_config(8124, False)
    assert (installed / "__init__.py").read_text() == "original"


def test_with_http_port_updates_only_http_server_port() -> None:
    configuration = "http:\n  server_port: 8124\nother:\n  server_port: 9000\n"

    updated = _with_http_port(configuration, 8125)

    assert updated == "http:\n  server_port: 8125\nother:\n  server_port: 9000\n"


def test_with_http_port_adds_port_to_existing_http_section() -> None:
    configuration = "http:\n  use_x_forwarded_for: true\nfrontend:\n"

    updated = _with_http_port(configuration, 8125)

    assert updated == "http:\n  use_x_forwarded_for: true\n  server_port: 8125\nfrontend:\n"


def test_with_http_port_adds_http_section_when_missing() -> None:
    configuration = "frontend:\n"

    updated = _with_http_port(configuration, 8125)

    assert updated == "frontend:\n\nhttp:\n  server_port: 8125\n"


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


async def test_onboard_uses_requested_port(monkeypatch, tmp_path) -> None:
    class Response:
        def __init__(self, data):
            self.data = data

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        def raise_for_status(self):
            return None

        async def json(self):
            return self.data

    class Session:
        def __init__(self):
            self.posts = []

        def post(self, url, **kwargs):
            self.posts.append((url, kwargs))
            if url.endswith("/api/onboarding/users"):
                data = {"auth_code": "auth-code"}
            elif url.endswith("/auth/token"):
                data = {"access_token": "access-token"}
            else:
                data = {}
            return Response(data)

    async def fake_websocket(_base, _session, _token, *_messages):
        return "long-lived-token"

    token_file = tmp_path / ".dev-token"
    monkeypatch.setattr(dev_ha, "TOKEN_FILE", token_file)
    monkeypatch.setattr(dev_ha, "websocket", fake_websocket)
    session = Session()

    token = await onboard("http://127.0.0.1:8125", session, 8125)

    assert token == "long-lived-token"
    assert token_file.read_text() == token
    assert session.posts[0][1]["json"]["client_id"] == "http://localhost:8125/"
    assert session.posts[1][1]["data"]["client_id"] == "http://localhost:8125/"
    assert session.posts[4][1]["json"] == {
        "client_id": "http://localhost:8125/",
        "redirect_uri": "http://localhost:8125/?auth_callback=1",
    }


@pytest.mark.parametrize(
    ("saved_alerts", "route_failures"),
    [([], 0), ([], 2), ([{"id": "user_alert"}], 0)],
)
async def test_seed_populates_only_empty_alert_config(
    monkeypatch, saved_alerts, route_failures,
) -> None:
    class Response:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def json(self):
            return [{"entry_id": "ha-notifications"}]

    class Session:
        def get(self, _url, **_kwargs):
            return Response()

    websocket_calls = []
    get_config_calls = 0

    async def fake_websocket(_base, _session, _token, message):
        nonlocal get_config_calls
        websocket_calls.append(message)
        if message["type"] == "ha_notifications/get_config":
            get_config_calls += 1
            if get_config_calls <= route_failures:
                raise RuntimeError("ha_notifications/get_config: unknown_command")
            return {"version": 1, "alerts": saved_alerts}
        if message["type"] == "get_states":
            return [{"entity_id": "notify.phone"}]
        return message["config"]

    monkeypatch.setattr(dev_ha, "websocket", fake_websocket)

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(dev_ha.asyncio, "sleep", no_wait)

    await dev_ha.seed("http://localhost:8124", Session(), "token")

    assert get_config_calls == route_failures + 1
    save_calls = [call for call in websocket_calls if call["type"] == "ha_notifications/save_config"]
    if saved_alerts:
        assert save_calls == []
    else:
        assert [alert["id"] for alert in save_calls[0]["config"]["alerts"]] == [
            "front_door_switch",
            "full_feature",
        ]
        assert save_calls[0]["config"]["alerts"][0]["notification"]["target"] == {
            "entity_id": ["notify.phone"],
        }


async def test_ensure_mock_mobile_app_repairs_entry_and_registers_once(monkeypatch, tmp_path) -> None:
    class Response:
        def __init__(self, data, status=200):
            self.data = data
            self.status = status

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        def raise_for_status(self):
            if self.status >= 400:
                raise RuntimeError(f"HTTP {self.status}")
            return None

        async def json(self):
            return self.data

    class Session:
        def __init__(self):
            self.entries = [{"entry_id": "old-entry", "title": MOCK_DEVICE_NAME}]
            self.posts = []
            self.deletes = []
            self.post_statuses = [404, 201]
            self.has_notify_entity = False

        def get(self, _url, **_kwargs):
            return Response(list(self.entries))

        def delete(self, url, **_kwargs):
            self.deletes.append(url)
            self.entries.clear()
            return Response({})

        def post(self, url, **kwargs):
            self.posts.append((url, kwargs))
            status = self.post_statuses.pop(0)
            if status != 404:
                self.entries.append({"entry_id": "new-entry", "title": MOCK_DEVICE_NAME})
                self.has_notify_entity = True
            return Response({"webhook_id": "mock-webhook"}, status)

    async def list_entities(_base, _session, _token, *_messages):
        if session.has_notify_entity:
            return [{"entity_id": "notify.ha_notifications_dev_phone", "config_entry_id": "new-entry"}]
        return []

    session = Session()
    push_url_file = tmp_path / ".dev-mobile-app-push-url"
    monkeypatch.setattr(dev_ha, "MOCK_PUSH_URL_FILE", push_url_file)

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(dev_ha.asyncio, "sleep", no_wait)
    monkeypatch.setattr(dev_ha, "websocket", list_entities)

    push_url = "http://127.0.0.1:8126/notify"
    await ensure_mock_mobile_app("http://localhost:8124", session, "token", push_url)
    await ensure_mock_mobile_app("http://localhost:8124", session, "token", push_url)

    assert push_url_file.read_text() == push_url
    assert session.deletes == ["http://localhost:8124/api/config/config_entries/entry/old-entry"]
    assert len(session.posts) == 2
    assert session.posts[0][0] == "http://localhost:8124/api/mobile_app/registrations"
    assert session.posts[0][1]["json"]["device_name"] == MOCK_DEVICE_NAME
    assert session.posts[0][1]["json"]["os_name"] == "Android"
    assert session.posts[1][1]["json"]["app_data"] == {
        "push_token": "ha-notifications-dev",
        "push_url": push_url,
    }