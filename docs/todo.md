# TODO status

All items from the original implementation TODO are complete for the current
repository layout.

- [x] Persist one canonical `notification` instead of both `notification` and `notifications`.
- [x] Remove duplicated top-level confirmation data from persisted alerts.
- [x] Remove persisted `logic` and use `AND` semantics for multiple conditions.
- [x] Omit empty `actions` and add explicit `actions_enabled`.
- [x] Preserve alert metadata such as `description`, `icon`, `created_at`, and `updated_at`.
- [x] Replace an existing alert during save instead of merging its configuration.
- [x] Use Home Assistant's `ha-code-editor` for YAML syntax highlighting.
- [x] Keep the alert YAML view inside the editor instead of navigating to the global YAML tab.
- [x] Make recipient results part of the normal layout so the dropdown cannot be hidden behind the editor.
- [x] Use switch-style controls for confirmation and follow-up-action enablement.
- [x] Split frontend responsibilities into focused TypeScript modules.
- [x] Compile frontend TypeScript to `custom_components/notification_center/frontend/dist` and serve browser-loadable JavaScript.
- [x] Remove the unused `frontend.py` frontend registration.
- [x] Remove repeated frontend section-divider comments.
- [x] Use one source of truth for panel title, icon, version, and static resource paths.
- [x] Add compiled-frontend smoke coverage alongside the backend test suite.
- [x] Add a development container with Python, Node, dependencies, and a post-create build.
- [x] Remove legacy YAML migration and require the canonical configuration shape.
- [x] Add a HACS export script that packages compiled frontend output separately from source.
- [x] Add a local Home Assistant installer for an ignored custom-components test directory.

## Development checks

Backend:

```bash
PYTHONPATH=tests python -m unittest test_models test_storage test_notifications_payload test_config_contract -q
```

Frontend:

```bash
npm install
npm run typecheck
npm run build
npm run test:frontend
```

The frontend source of truth is `custom_components/notification_center/frontend/*.ts`. JavaScript is a release
artifact only: run `npm run build` when packaging the Home Assistant panel.
The generated `custom_components/notification_center/frontend/dist/` directory is ignored and is not part of the
source tree.
