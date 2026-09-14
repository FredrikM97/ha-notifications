# TODO status

## Known issues / follow-ups

- **Recipient validation errors don't say which recipient is invalid.**
  When a selected notification target mixes recipients that resolve to a
  valid direct notify service with ones that don't (e.g. one device has a
  registered Mobile App notify service, another doesn't), the unresolved
  ones are silently dropped in
  `controller/notifications.py`'s `_legacy_mobile_app_services_for_target`/
  `_verified_legacy_mobile_app_services`. If that drops every recipient,
  the caller only ever sees the generic
  `"No valid notify service was found for the selected recipients."`
  (`controller/notifications.py`, `_notification_route`) with no
  indication of which of the originally selected devices/entities/areas
  were the problem versus which were fine. Fix should surface a per-recipient
  breakdown (valid vs. invalid, and why) back through to
  `frontend/recipient-picker.ts`/the save-error toast, not just a single
  pass/fail message for the whole target.

- [x] **Split editor sections into one file each, to isolate logic per
  feature.** `frontend/editor/sections.ts` used to hold all 10 section
  render functions in one file; each now lives in its own file under
  `frontend/sections/` (`basic.ts`, `monitor.ts`, `condition.ts`,
  `recipients.ts`, `notification.ts`, `reminder-interval.ts`,
  `post-send-actions.ts`, `confirmation.ts`,
  `confirmation-notification.ts`, `post-confirmation-actions.ts`), with
  `frontend/sections.ts` now a barrel that re-exports them (only
  `editor/index.ts`'s one import line needed updating). A new section is
  now one new file + one export line. Verified: `npm run build && npm run
  test:frontend && npx vitest run`.
  - [x] **Moved up one level**: initially placed under
    `frontend/editor/sections/`; moved to `frontend/sections/` (and the
    barrel to `frontend/sections.ts`) per feedback that nesting it inside
    `editor/` made it harder to find/manage, since sections aren't
    exclusively an editor-internal concern. Verified again after the move.
  - **Backend half still open**: extend the same idea per Phase 8's
    "Adding a New Feature" recipe in `docs/architecture.md` - give each
    independently-evaluated concern its own `controller/<feature>.py`
    module rather than adding branches to existing ones. No new backend
    module was needed yet since no new feature has been added; tracked
    here so the intent isn't lost. This is the frontend half of the
    still-open Phase 7 (full component-per-feature Lit split) below.

- **Backend feature modules shouldn't live directly under `controller/`.**
  `controller/` currently mixes the kernel (`core.py`, `commands.py`) with
  feature/decision modules (`alerts.py`, `responses.py`, `notifications.py`,
  `actions.py`) in one flat folder. Move the feature modules into their
  own folder, named to mirror the frontend's structure (the frontend now
  has a top-level `frontend/sections/` for per-section UI, so a top-level
  `controller/features/` - or similar - would read consistently), keeping
  `core.py`/`commands.py` as the kernel's own files. Open questions to
  resolve before doing this:
  - Should a "feature" that has natural sub-parts (e.g. a hypothetical
    confirmation feature with a template-rendering sub-piece) live as one
    file, or split into a subfolder of its own? i.e. does splitting go
    arbitrarily deep, or should closely-related sub-logic stay in one file
    to avoid over-fragmenting and losing the plot across too many small
    files? No decision made yet - needs discussion before implementing.
  - Once `controller/features/` (or whatever it's named) exists, does
    `bridge/websocket.py` still call `controller/core.py` exclusively (per
    the existing "one interface per subsystem" rule), or would per-feature
    modules ever be called more directly? Current architecture rule says
    core.py stays the only entry point - confirm that still holds before
    moving anything.
  Not implemented - this needs the open questions above resolved first,
  ideally alongside Phase 7's frontend component split so both sides
  settle on matching names/structure at the same time.

## Architecture rewrite (in progress)

Full backend restructuring per `docs/architecture.md` target shape: one HA
gateway, one controller "brain" package, pure sub-managers, a shared
`domain/` layer, and a two-file `frontend_bridge/`. All backend phases are
complete; `python3 -m pytest tests/` is green (99 passed) and
`npm run build && npm run test:frontend` pass.

**Remaining follow-up (not done in this pass):** `frontend/editor/index.ts`'s
`AlertEditorController` and `frontend/editor/helpers.ts`'s `showYaml()`/
`showEditorToast()` still use imperative DOM (`document.createElement`,
manual `classList`/attribute manipulation) instead of pure Lit rendering.
This is UI behavior best verified in a browser, not just by
`tsc`/`esbuild`/the smoke test, so it's deliberately left for a dedicated
follow-up session rather than converted blind. See
`docs/architecture.md`'s "Frontend Shape" section and the session plan's
Further Considerations for the target shape.

- [x] Phase 0 — this checklist.
- [x] Phase 1 — `ha/gateway.py`, the sole Home Assistant API wrapper.
- [x] Phase 2 — `controller/commands.py`, the closed Command vocabulary.
- [x] `domain/` rename — `models.py`/`model_conditions.py`/`durations.py`
      moved to `domain/alert_schema.py`/`domain/condition_schema.py`/
      `domain/durations.py`; all callers updated; tests green.
- [x] Phase 3 — pure `controller/notifications.py` (replaces `delivery/`).
- [x] Phase 4 — pure `controller/alerts.py` + `controller/responses.py`
      (replaces `runtime/engine.py` + `runtime/state.py` +
      `runtime/confirmations.py` + `runtime/drafts.py`).
- [x] Phase 5 — pure `controller/actions.py` (replaces `runtime/actions.py`).
- [x] Phase 6 — pure `storage.py`, `history.py`, `panel.py`.
- [x] Phase 7 — `controller/core.py`, the kernel.
- [x] Phase 8 — `frontend_bridge/` (`validation.py` + `websocket.py`).
- [x] Phase 9 — rewire `__init__.py` to minimal glue.
- [x] Phase 10 — delete retired modules (`notifications.py`, top-level
      `websocket.py`, `runtime/`, `delivery/`, `templating.py`, top-level
      `models.py`/`model_conditions.py`/`durations.py`).
- [x] Phase 11 — test suite overhaul: `tests/test_controller_alerts.py`,
      `tests/test_controller_responses.py`, `tests/test_controller_notifications.py`,
      `tests/test_controller_actions.py`, `tests/test_controller_core.py`
      (golden-path with a fake gateway), rewritten `tests/test_history.py` /
      `tests/test_storage.py`. Full suite: 99 passed.
- [x] Phase 12 — frontend Lit conversion: `frontend/toast.ts` (shared
      Lit-rendered toast list), `panel.ts` `showToast()` now uses it.
      `editor/index.ts`/`editor/helpers.ts`'s remaining imperative-DOM
      controller (host div, section nav, `showYaml` modal) is NOT yet
      converted — flagged as a separate follow-up needing browser-based
      verification (see Further Considerations in the session plan).
- [x] Phase 12b — frontend readability cleanup: `history.ts` ternaries
      inlined and duplicate show-all button collapsed;
      `editor/helpers.ts`/`editor/index.ts` dead `toggleTitle` import removed
      (kept the function itself — it has 2 real call sites across files).
- [x] Phase 13 — `docs/architecture.md` and `.github/logic-index.md`
      rewritten to match the new architecture.
- [x] `domain/alert_schema.py`, `domain/condition_schema.py`,
      `domain/durations.py` — renamed/relocated (was `models.py`,
      `model_conditions.py`, `durations.py`); folded into Phase 6.

## Legacy TODO (complete for the pre-rewrite layout)

All items below were complete for the repository layout prior to the
architecture rewrite above.

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
- [x] Compile frontend TypeScript and serve a browser-loadable `frontend/panel.js` bundle.
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
artifact: build it before running the installer or packaging the Home Assistant panel. The build produces one bundled
`dist/panel.js` file, which the installer and HACS export package unchanged.
