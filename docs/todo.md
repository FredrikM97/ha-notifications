# TODO status

The original TODO has been addressed in the current working tree.

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
- [x] Split the frontend into TypeScript modules and compile them into `frontend/dist`.
- [x] Remove the unused `frontend.py` frontend registration.
- [x] Remove repeated frontend section-divider comments.
- [ ] Remove dist and keep logic under /frontend
- [ ] Rework structure of files into smaller component to increate maintainability and readability
- [ ] Avoid declaring buttons at the top example `const buttons =
      document.createElement(
        "div",
      );
` This does not improve redability and feel bad approach in typoescript
- [ ] Rewrite the typescript to be best practise for the codebase
- [ ] The constants in panel.py is very odd and the mix of static constants and the paths for panel make it unclear and difficult to follow. Rework it . Likewise with these `FRONTEND_STATIC_URL = "/notification_center_static"
PANEL_URL = "notification-center"
PANEL_URL_PATH = "notification_center"
STATIC_URL_PATH = "/notification_center_static"
PANEL_TITLE = "Notification Center"` we mix a lot so try unify to common setup and library foir best practise
- [ ] Implement better testing between backend and frontend to test everything. Right now we fail a lot on not being able to access frontend etc which cauyse lots of issues.
- [ ] Remove legacy code should not be needed
 ## Notes

Legacy YAML is still accepted when loading. The normalized configuration written back to disk uses the
canonical structure documented in `README.md`.

The frontend source of truth is now `frontend/src/*.ts`. `frontend/dist/*.js` is generated output
served by the Home Assistant panel.

The existing Python unit tests can be run without the Home Assistant test dependency using:

```bash
PYTHONPATH=tests python -m unittest test_models test_storage test_notifications_payload test_config_contract -q
```

Frontend validation:

```bash
npm run typecheck
npm run build
```
