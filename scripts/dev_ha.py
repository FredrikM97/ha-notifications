"""Run a throwaway local Home Assistant with this integration for UI development.

Usage: npm run dev (or: python3 scripts/dev_ha.py [--reset] [--port 8124])
"""

from __future__ import annotations

import argparse
import asyncio
import fcntl
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / ".ha-config"
LOCK_FILE = Path(tempfile.gettempdir()) / f"ha-notifications-dev-{hashlib.sha256(str(ROOT).encode()).hexdigest()[:16]}.lock"
INTEGRATION = ROOT / "custom_components" / "ha_notifications"
TOKEN_FILE = CONFIG / ".dev-token"
CLIENT_ID = "http://localhost:8124/"

CONFIGURATION_YAML = """\
frontend:
config:
automation:
script:
history:
logbook:
system_log:

homeassistant:
  name: HA Notifications Dev
  auth_providers:
    - type: trusted_networks
      trusted_networks:
        - "127.0.0.1/32"
        - "::1/128"
        - "10.0.0.0/8"
        - "172.16.0.0/12"
        - "192.168.0.0/16"
      allow_bypass_login: true
    - type: homeassistant

http:
  server_port: {port}

logger:
  default: warning
  logs:
    custom_components.ha_notifications: debug

input_boolean:
  front_door:
    name: Front door
  window:
    name: Window
  hall_light:
    name: Hall light

template:
  - binary_sensor:
      - name: Door
        unique_id: dev_door
        state: "{{{{ is_state('input_boolean.front_door', 'on') }}}}"
      - name: Window
        unique_id: dev_window
        state: "{{{{ is_state('input_boolean.window', 'on') }}}}"
  - sensor:
      - name: Temperature
        unique_id: dev_temperature
        unit_of_measurement: "°C"
        state: "21"
"""


def _with_http_port(configuration: str, port: int) -> str:
    lines = configuration.splitlines()
    http_index = next(
        (index for index, line in enumerate(lines) if line.partition("#")[0].strip() == "http:"),
        None,
    )
    if http_index is None:
        lines.extend(["", "http:", f"  server_port: {port}"])
    else:
        for index in range(http_index + 1, len(lines)):
            line = lines[index]
            if line and not line[0].isspace():
                lines.insert(index, f"  server_port: {port}")
                break
            if line.strip().startswith("server_port:"):
                indentation = line[: len(line) - len(line.lstrip())]
                lines[index] = f"{indentation}server_port: {port}"
                break
        else:
            lines.append(f"  server_port: {port}")
    return "\n".join(lines) + "\n"


def prepare_config(port: int, reset: bool) -> Path:
    if reset and CONFIG.exists():
        shutil.rmtree(CONFIG)
    (CONFIG / "custom_components").mkdir(parents=True, exist_ok=True)
    (CONFIG / "custom_components" / "__init__.py").touch()
    installed = CONFIG / "custom_components" / "ha_notifications"
    if installed.is_symlink():
        installed.unlink()
    elif installed.exists():
        shutil.rmtree(installed)
    shutil.copytree(INTEGRATION, installed, ignore=shutil.ignore_patterns("frontend", "__pycache__", "*.pyc"))
    bundle = installed / "frontend" / "panel.js"
    bundle.parent.mkdir()
    configuration = CONFIG / "configuration.yaml"
    if not configuration.exists():
        configuration.write_text(CONFIGURATION_YAML.format(port=port))
    existing = configuration.read_text()
    updated = _with_http_port(existing, port)
    if updated != existing:
        configuration.write_text(updated)
    return bundle


async def wait_for_http(base: str, session: aiohttp.ClientSession) -> None:
    for _ in range(240):
        try:
            async with session.get(f"{base}/api/onboarding") as response:
                if response.status < 500:
                    return
        except aiohttp.ClientError:
            pass
        await asyncio.sleep(0.5)
    raise TimeoutError("Home Assistant did not start within 2 minutes.")


async def websocket(base: str, session: aiohttp.ClientSession, token: str, *messages: dict) -> object:
    result: object = None
    async with session.ws_connect(f"{base.replace('http', 'ws', 1)}/api/websocket") as ws:
        await ws.receive_json()
        await ws.send_json({"type": "auth", "access_token": token})
        if (await ws.receive_json())["type"] != "auth_ok":
            raise RuntimeError("Websocket authentication failed.")
        for index, message in enumerate(messages, start=1):
            await ws.send_json({"id": index, **message})
            while (reply := await ws.receive_json()).get("id") != index:
                pass
            if not reply.get("success", True):
                raise RuntimeError(f"{message['type']}: {reply.get('error')}")
            result = reply.get("result")
    return result


async def onboard(base: str, session: aiohttp.ClientSession) -> str:
    async with session.post(
        f"{base}/api/onboarding/users",
        json={
            "name": "Developer",
            "username": "dev",
            "password": "dev",
            "client_id": CLIENT_ID,
            "language": "en",
        },
    ) as response:
        response.raise_for_status()
        code = (await response.json())["auth_code"]
    async with session.post(
        f"{base}/auth/token",
        data={"grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID},
    ) as response:
        response.raise_for_status()
        access = (await response.json())["access_token"]
    headers = {"Authorization": f"Bearer {access}"}
    for step, body in (
        ("core_config", None),
        ("analytics", None),
        ("integration", {"client_id": CLIENT_ID, "redirect_uri": f"{CLIENT_ID}?auth_callback=1"}),
    ):
        async with session.post(f"{base}/api/onboarding/{step}", json=body, headers=headers):
            pass
    token = await websocket(
        base,
        session,
        access,
        {"type": "auth/long_lived_access_token", "client_name": "dev", "lifespan": 3650},
    )
    TOKEN_FILE.write_text(token)
    return token


def _notify_entities(states: object) -> list[str]:
    if not isinstance(states, list):
        return []
    return sorted(
        {
            entity_id
            for state in states
            if isinstance(state, dict)
            and isinstance((entity_id := state.get("entity_id")), str)
            and entity_id.startswith("notify.")
        }
    )


async def seed(base: str, session: aiohttp.ClientSession, token: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    async with session.get(
        f"{base}/api/config/config_entries/entry?domain=ha_notifications", headers=headers
    ) as response:
        if await response.json():
            return
    async with session.post(
        f"{base}/api/config/config_entries/flow", json={"handler": "ha_notifications"}, headers=headers
    ) as response:
        flow = await response.json()
    if flow.get("type") == "form":
        async with session.post(
            f"{base}/api/config/config_entries/flow/{flow['flow_id']}", json={}, headers=headers
        ):
            pass
    fixtures = json.loads((ROOT / "tests" / "backend" / "fixtures" / "alerts.json").read_text())
    alerts = [fixtures["full_feature"], fixtures["configuration"]]
    states = await websocket(base, session, token, {"type": "get_states"})
    entities = _notify_entities(states)
    for alert in alerts:
        notification = alert["notification"]
        notification.pop("action", None)
        notification.pop("target", None)
        if entities:
            notification["target"] = {"entity_id": entities}
        else:
            alert["enabled"] = False
            confirmation = alert.get("confirmation")
            if isinstance(confirmation, dict):
                confirmation_notification = confirmation.get("notification")
                if isinstance(confirmation_notification, dict):
                    confirmation_notification.pop("action", None)
                    confirmation_notification.pop("target", None)
    alerts[1]["name"] = "Window left open"
    if not entities:
        print("[dev] No notify entities found; sample alerts are disabled until one is configured.", flush=True)
    await websocket(
        base,
        session,
        token,
        {"type": "ha_notifications/save_config", "config": {"version": 1, "alerts": alerts}},
    )


async def bootstrap(port: int) -> None:
    base = f"http://127.0.0.1:{port}"
    async with aiohttp.ClientSession() as session:
        await wait_for_http(base, session)
        token = TOKEN_FILE.read_text() if TOKEN_FILE.exists() else await onboard(base, session)
        try:
            await websocket(base, session, token, {"type": "http/config/promote"})
        except RuntimeError:
            pass
        try:
            await seed(base, session, token)
        except Exception as error:
            print(f"[dev] Seeding sample alerts failed: {error}", flush=True)
    print(f"\n[dev] Ready: http://localhost:{port}/ha_notifications  (no login needed)\n", flush=True)


@contextmanager
def dev_instance():
    with LOCK_FILE.open("a+") as lock:
        deadline = time.monotonic() + 45
        stopped = set()
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                lock.seek(0)
                owner = lock.read().strip()
                if owner.isdecimal() and int(owner) not in stopped:
                    print(f"[dev] Stopping previous dev instance ({owner})...", flush=True)
                    try:
                        os.kill(int(owner), signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    stopped.add(int(owner))
                if time.monotonic() >= deadline:
                    raise TimeoutError("Previous dev instance did not stop; refusing to start another.")
                time.sleep(0.1)
        lock.seek(0)
        lock.truncate()
        lock.write(str(os.getpid()))
        lock.flush()
        try:
            yield
        finally:
            lock.seek(0)
            lock.truncate()
            lock.flush()
            fcntl.flock(lock, fcntl.LOCK_UN)


def stop_processes(processes: list[subprocess.Popen]) -> None:
    for process in processes:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for process in processes:
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()


def run_dev(port: int, reset: bool) -> None:
    processes = []

    def stop(*_: object) -> None:
        raise SystemExit(0)

    # Children run in their own sessions, so a closed terminal (SIGHUP) must stop them here.
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, stop)
    with dev_instance():
        try:
            bundle = prepare_config(port, reset)
            build_command = [
                "npx", "esbuild", "frontend/panel.ts", "--bundle", "--format=esm",
                f"--outfile={bundle}", "--sourcemap", "--log-level=warning",
            ]
            processes.append(subprocess.Popen(build_command, cwd=ROOT, start_new_session=True))
            if processes[-1].wait() != 0:
                raise RuntimeError("Initial frontend build failed.")
            processes.append(subprocess.Popen([*build_command, "--watch=forever"], cwd=ROOT, start_new_session=True))
            processes.append(subprocess.Popen(
                [sys.executable, "-m", "homeassistant", "-c", str(CONFIG)], cwd=CONFIG, start_new_session=True,
            ))
            asyncio.run(bootstrap(port))
            result = processes[-1].wait()
            if result:
                raise RuntimeError(f"Home Assistant exited with status {result}.")
        finally:
            for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                signal.signal(signum, signal.SIG_IGN)
            stop_processes(processes)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8124)
    parser.add_argument("--reset", action="store_true", help="wipe .ha-config first")
    args = parser.parse_args()

    run_dev(args.port, args.reset)


if __name__ == "__main__":
    main()
