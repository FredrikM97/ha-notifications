"""Run a throwaway local Home Assistant with this integration for UI development.

Usage: npm run dev   (or: python3 scripts/dev_ha.py [--reset] [--port 8124])

- Config lives in .ha-config/ (gitignored); --reset wipes it.
- The integration source is symlinked in, and esbuild watches frontend/ and
  writes the bundle where HA serves it uncached: save, then reload the page.
- First run completes onboarding, adds the config entry, and seeds alerts.
- Login is skipped for local clients via the trusted_networks auth provider.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import signal
import subprocess
import sys
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / ".ha-config"
INTEGRATION = ROOT / "custom_components" / "ha_notifications"
BUNDLE = INTEGRATION / "frontend" / "dev.js"
# HA's service worker caches panel.js; a per-load URL always fetches the fresh bundle.
LOADER = 'await import(`./dev.js?t=${Date.now()}`);\n'
TOKEN_FILE = CONFIG / ".dev-token"
CLIENT_ID = "http://localhost:8124/"

CONFIGURATION_YAML = """\
# Minimal explicit set; default_config pulls integrations with uninstalled deps.
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

# Demo entities so triggers, conditions and actions have something to target.
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


def prepare_config(port: int, reset: bool) -> None:
    if reset and CONFIG.exists():
        shutil.rmtree(CONFIG)
    (CONFIG / "custom_components").mkdir(parents=True, exist_ok=True)
    link = CONFIG / "custom_components" / "ha_notifications"
    if not link.is_symlink():
        if link.exists():
            shutil.rmtree(link)
        link.symlink_to(INTEGRATION, target_is_directory=True)
    configuration = CONFIG / "configuration.yaml"
    if not configuration.exists():
        configuration.write_text(CONFIGURATION_YAML.format(port=port))


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


async def onboard(base: str, session: aiohttp.ClientSession) -> str:
    """Finish onboarding and return a long-lived access token."""
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
        base, session, access, {"type": "auth/long_lived_access_token", "client_name": "dev", "lifespan": 3650}
    )
    TOKEN_FILE.write_text(token)
    return token


async def websocket(
    base: str, session: aiohttp.ClientSession, token: str, *messages: dict
) -> object:
    """Send messages over one authenticated websocket; return the last result."""
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


def _notify_entities(states: object) -> list[str]:
    if not isinstance(states, list):
        return []
    entities = {
        entity_id
        for state in states
        if isinstance(state, dict)
        and isinstance((entity_id := state.get("entity_id")), str)
        and entity_id.startswith("notify.")
    }
    return sorted(entities)


async def seed(base: str, session: aiohttp.ClientSession, token: str) -> None:
    """Add the integration entry and canonical sample alerts once."""
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
    notify_entities = _notify_entities(states)
    for alert in alerts:
        notification = alert["notification"]
        notification.pop("action", None)
        notification.pop("target", None)
        if notify_entities:
            notification["target"] = {"entity_id": notify_entities}
        else:
            alert["enabled"] = False
            confirmation = alert.get("confirmation")
            if isinstance(confirmation, dict):
                confirmation_notification = confirmation.get("notification")
                if isinstance(confirmation_notification, dict):
                    confirmation_notification.pop("action", None)
                    confirmation_notification.pop("target", None)
    alerts[1]["name"] = "Window left open"
    if not notify_entities:
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
            # Non-default ports are otherwise staged for confirmation and auto-revert.
            await websocket(base, session, token, {"type": "http/config/promote"})
        except RuntimeError:
            pass
        try:
            await seed(base, session, token)
        except Exception as error:  # Seeding is a convenience; keep the instance running.
            print(f"[dev] Seeding sample alerts failed: {error}", flush=True)
    print(f"\n[dev] Ready: http://localhost:{port}/ha_notifications  (no login needed)\n", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8124)
    parser.add_argument("--reset", action="store_true", help="wipe .ha-config first")
    args = parser.parse_args()

    prepare_config(args.port, args.reset)
    BUNDLE.parent.mkdir(exist_ok=True)
    (BUNDLE.parent / "panel.js").write_text(LOADER)
    processes = [
        subprocess.Popen(
            ["npx", "esbuild", "frontend/panel.ts", "--bundle", "--format=esm",
             f"--outfile={BUNDLE}", "--sourcemap", "--watch=forever", "--log-level=warning"],
            cwd=ROOT,
        ),
        subprocess.Popen([sys.executable, "-m", "homeassistant", "-c", str(CONFIG)], cwd=ROOT),
    ]

    def stop(*_: object) -> None:
        for process in processes:
            process.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        asyncio.run(bootstrap(args.port))
    except Exception as error:
        print(f"[dev] Bootstrap failed: {error}", flush=True)
    processes[1].wait()
    stop()


if __name__ == "__main__":
    main()
