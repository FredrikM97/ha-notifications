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

## Notification debug logs

The dev instance already enables `custom_components.ha_notifications` debug
logging. After backend changes, restart dev to load the updated integration.
Send and clear log the destination action, alert and flow IDs, and the final
payload immediately before calling the notify service. A separate completion
line means the service returned successfully, not that a device displayed it.

For an existing Home Assistant, enable logging temporarily in Developer Tools
with the `logger.set_level` action:

```yaml
action: logger.set_level
data:
  custom_components.ha_notifications.notification: debug
```

Trigger the alert and inspect `home-assistant.log` in the configuration directory
(the dev instance uses `.ha-config/home-assistant.log`). Debug payloads include
notification content and device options; redact them before sharing and set the
logger back to `warning` when finished.

## Parallel Features

Use one branch and Git worktree per feature. Branches alone still share the
current checkout and index; worktrees provide separate files and staging areas.
Create them from a clean committed base, with feature-specific names:

```bash
git worktree add -b fix/reminder-message ../nc-reminder-message HEAD
git worktree add -b refactor/editor-defaults ../nc-editor-defaults HEAD
```

Open each worktree in its own VS Code window. Commit only that feature's source,
tests, and necessary documentation there. Merge or cherry-pick its commits when
ready; do not include unrelated instruction cleanup in a behavior-fix commit.
For already mixed uncommitted changes, use selective staging (`git add -p`)
before creating focused commits; switching branches does not separate them.
Agents must not create branches, stage, or commit without an explicit request.

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

The mobile delivery test runs generated automations through real Home Assistant
core and device registries, using Android and iOS registration metadata and a
recording `notify` service:

```bash
python3 -m pytest tests/backend/test_mobile_delivery.py
```

The notify service and unrelated sidebar registration are stubbed. Snapshots
cover our outgoing service payload: message, title, native device options, and
clear-notification tags. This does not load Home Assistant's native `mobile_app`
integration or verify its push-gateway conversion. It does not contact a push
provider or physical device, and cannot prove how a phone displays notifications.

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
