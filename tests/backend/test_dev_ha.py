import os
import subprocess
import sys
from unittest.mock import Mock, call

import pytest

from scripts import dev_ha
from scripts.dev_ha import _notify_entities, _with_http_port


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