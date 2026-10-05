# Development

## Setup

```bash
npm ci
python3 -m pip install -e .
git config core.hooksPath .githooks   # optional: run checks before each commit
```

## Run it

`npm run dev` starts a throwaway Home Assistant with this integration loaded:

```bash
npm run dev               # http://localhost:8124/ha_notifications
npm run dev -- --reset    # start again from a clean instance
```

- Real Home Assistant and its frontend: every switch, selector, and editor is
  the genuine component, and every API call reaches the real backend.
- No login for local clients, and sample alerts are seeded on first run.
- The frontend rebuilds on save; reload the page to see changes.
- State lives in the gitignored `.ha-config/`.

Starting `npm run dev` again stops the previous instance for this repository and
its child processes. It stages a fresh integration copy under `.ha-config/`;
generated frontend output never goes into the authored integration. Restart dev
after backend changes to refresh the staged Python files.

For another port or a clean throwaway instance:

```bash
npm run dev -- --port 8125
npm run dev -- --reset
```

The devcontainer publishes port 8124 on the Docker host. Rebuild the container
after changing its configuration, then browse to
`http://<docker-host-LAN-IP>:8124/ha_notifications` from another device. Allow
TCP 8124 through the host firewall if required; the host port must be free.
Alternate dev ports require matching port mappings.

The dev configuration bypasses login for private-network clients. Use LAN
access only on a trusted network; remove the `trusted_networks` auth provider in
`.ha-config/configuration.yaml` to require login on a shared network. Do not
expose the dev instance to the internet.

## Validate

```bash
sh scripts/validate.sh    # everything: lint, backend tests, frontend build and tests
```

Focused checks while working:

```bash
python3 -m pytest tests/backend/test_automation.py
python3 -m ruff check custom_components/ha_notifications tests/backend
npm run typecheck
npm run build
```

Backend tests run a real Home Assistant core (see `tests/backend/conftest.py`)
using the `homeassistant` package directly; there is no
`pytest-homeassistant-custom-component` dependency. Snapshots use Syrupy;
review changes with:

```bash
python3 -m pytest --snapshot-update
```

## Project layout

```
custom_components/ha_notifications/   Python integration
  configuration.py   Canonical config schema (pydantic)
  automation*.py     Generating, storing, and reconciling automations
  notification.py    send / clear / command / report services
  history.py         Persistent history (batched writes)
  bridge/            Websocket API and panel registration
frontend/            Lit + TypeScript panel (see frontend/AGENTS.md)
tests/backend/       pytest suites, fixtures, and snapshots
tests/frontend/      Vitest suites
scripts/             dev_ha.py, validation, local install, HACS packaging
```

The panel bundle is served from the integration's `frontend/` folder with a
content-hashed URL, so a browser never runs a stale build after an update.

## Install into an existing Home Assistant

```bash
npm run build
sh scripts/install_local.sh /path/to/home-assistant-config
```

With no argument the script uses the config directory two levels above the
repository (the `config/repos/<repository>` layout) or `HA_CONFIG_DIR`.
The installer copies the complete `build/` integration into the selected
configuration directory after checking the required build files. It does not
start or restart Home Assistant; restart the target instance separately.

The integration source is authored under `custom_components/ha_notifications/`.
The build writes the frontend bundle to `build/frontend/panel.js`. The local
install script copies that bundle into the installed integration, while the
HACS packaging script includes it in the release archive.

## HACS package

```bash
npm run package:hacs            # build and zip the integration
npm run package:hacs -- 1.2.3   # override the version for a release test
```

The ZIP contains the integration files at its root, as HACS expects with
`content_in_root`.
