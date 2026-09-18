# Development

## Setup

Install the Node and Python development dependencies from the repository root:

```bash
npm ci
python3 -m pip install -e ".[test]"
```

Run the complete local validation suite:

```bash
sh scripts/validate.sh
```

The suite checks Python lint and tests, the frontend build, frontend smoke
checks, and frontend unit tests.

To run the same checks automatically before each local commit:

```bash
git config core.hooksPath .githooks
```

Snapshots use Syrupy with Home Assistant-aware serialization. Review snapshot
changes explicitly with:

```bash
python3 -m pytest --snapshot-update
```

## Local Home Assistant

After building the frontend with `npm run build`, copy the current integration
into a local Home Assistant configuration. With no argument, the script uses
the Home Assistant config directory two levels above the repository (the
standard `config/repos/<repository>` layout); pass a path or set
`HA_CONFIG_DIR` to use another configuration:

```bash
sh scripts/install_local.sh /path/to/home-assistant-config
```

The integration source is authored under `custom_components/ha_notifications/`.
The build writes the frontend bundle to `dist/panel.js` and copies it to
`custom_components/ha_notifications/dist/panel.js` for Home Assistant.

## HACS package

Build the release HACS package locally:

```bash
npm run package:hacs
```

Pass a version to override the manifest for a release test:

```bash
npm run package:hacs -- 1.2.3
```

The package script builds the frontend, copies the canonical integration into a
temporary export tree, and creates a ZIP with the integration files at its root,
as expected by Home Assistant releases.

For source layout, feature ownership, and runtime flow, see
[architecture.md](architecture.md).
