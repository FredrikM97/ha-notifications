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

## HACS package

```bash
npm run package:hacs            # build and zip the integration
npm run package:hacs -- 1.2.3   # override the version for a release test
```

The ZIP contains the integration files at its root, as HACS expects with
`content_in_root`.
