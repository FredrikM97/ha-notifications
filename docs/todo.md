# TODO status

## Known issues / follow-ups

- [x] **Recipient validation errors don't say which recipient is invalid.**
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
  breakdown (valid vs. invalid, and why) through the existing save/test error
  toast. Mixed direct Mobile App recipients now fail with named details
  instead of silently dropping unresolved recipients; confirmation delivery
  errors include the same details.

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

- [x] **Split notification delivery by delivery type.** Shared target
  expansion now lives in `controller/notification_services/targets.py`,
  targeted notification planning in `targeted.py`, and Mobile App entry/service
  resolution in `mobile_app.py`. `controller/features/notifications.py`
  remains the single composer interface for `core.py`, so legacy and generic
  behavior have dedicated owners without duplicating the public wiring.
  - [x] **Naming/placement review:** the package is now
    `controller/notification_services/`, with role-based module names. It
    remains under `controller/` because it contains controller decisions and
    injected Home Assistant capability checks, not shared domain models.
  - [x] **Route classification:** avoid treating the literal action
    `notify.send_message` as the primary signal for the generic route. Add a
    dedicated classification step that derives the delivery type from legacy
    capabilities, target shape, and user recipients.
    The generic component now constructs its canonical action separately from
    that classification.
  - [x] **Remove notification-route compatibility:** target-based notifications
    now let the backend derive the generic route and no longer persist the
    generic `notify.send_message` action. Old generic action values normalize
    away. No notification delivery type or action is persisted; route
    selection uses the target, registry capabilities, and available notify
    services.
  - [x] **Remove empty notification actions:** target-based notification
    payloads no longer include `action: ""`; the editor default and normalized
    persisted shape omit the field. The backend evaluates the target and
    capabilities directly.

  - [x] **Mixed delivery targets:** a target containing both direct
    Mobile App-capable and unresolved recipients receives one shared
    notification through the generic target route. Do not issue both direct
    and generic calls for the same target, or recipients may receive
    duplicates. Mixed targets now prefer the generic route.
  - [x] **Remove generic action terminology:** the internal
    `generic_notify_action()` helper was removed. Delivery classification now
    selects a generic delivery path, which uses Home Assistant's
    `send_message` service internally without representing it as a persisted
    notification action.

  backend `controller/features/` package should not inherit from or
  auto-discover frontend `frontend/sections/` modules: backend features have
  different APIs, lifecycles, and runtime sequencing. Keep explicit imports
  from `controller/core.py` so startup behavior remains deterministic. If
  feature registration grows, add an explicit backend registry with typed
  entries rather than filesystem/module auto-discovery.

  modules now live under `controller/features/` (`triggering.py`,
  `confirmation.py`, `notification.py`, and `follow_up_actions.py`), while `core.py`, `commands.py`, and
  shared controller infrastructure remain at the package root. Each feature
  remains one file; related sub-logic is not split further. `core.py` remains
  the only runtime entry point.
  - **Decision for notification delivery:** this feature is split one level
    below `controller/` under `notification_services/`; recipient expansion is
    separate from targeted and Mobile App service logic. `controller/core.py`
    remains the only runtime entry point and continues to call
    `controller/features/notification.py`.

- [x] **Remove migration-era controller comments.** Feature modules and
  controller infrastructure now describe their current responsibilities
  directly instead of referring to retired `runtime/` and `delivery/`
  layouts or narrating which module used to own the code.

- [x] **Edit view should replace the dashboard view.** Pressing Edit should
  hide or navigate away from the dashboard alert panel and restore it when the
  editor closes. Currently the editor can leave dashboard content visible
  behind or alongside the edit view.

- [x] **Replace the reminder interval control with a real HH:MM:SS field.**
  The interval now uses separate hour, minute, and second inputs while
  preserving durations longer than 24 hours.

- [x] **Make "Check every" clock-aware.** This control is a duration, not a
  time-of-day clock, so it now uses an explicit `HH:MM:SS` format independent
  of the system's 12-hour or 24-hour convention.

- [x] **Keep user selectors out of notify service targets.** `user_id` is an
  editor/backend recipient selector and is expanded to supported entity/device
  targets before delivery. It is no longer forwarded to Home Assistant's
  generic notify service, which rejects it as an extra target key.

- [x] **Confirmation effects should be feature-owned.** The confirmation
  feature now plans clearing, completion notification, and post-confirmation
  actions in one `ConfirmationEffects` result. The controller kernel executes
  that plan instead of evaluating `notify_on_confirmation` itself, reducing
  drift between confirmation settings and runtime behavior.
  - [x] Core now supplies execution callbacks only; the confirmation feature
    owns effect ordering and decides which callbacks are invoked.

- [x] **Dispatch runtime states through typed transitions.** Triggering now
  emits `TransitionKind` state events and core routes them through a handler
  map. Core no longer contains one inline conditional chain deciding what each
  condition state means; feature transitions carry the action data and core
  executes the selected effect.

## Architecture rewrite (in progress)

Full backend restructuring per `docs/architecture.md` target shape: one HA
gateway, one controller "brain" package, pure sub-managers, a shared
`domain/` layer, and a two-file `frontend_bridge/`. All backend phases are
complete; `python3 -m pytest tests/` is green (99 passed) and
`npm run build && npm run test:frontend` pass.

**Remaining follow-up:** `frontend/editor/index.ts` and
`frontend/editor/helpers.ts` still contain imperative DOM orchestration around
the Lit templates. Convert the editor shell, section navigation, YAML modal,
and editor toasts to component-owned Lit state in a browser-verified pass.

- [x] Phase 0 — this checklist.
- [x] Phase 1 — `ha/gateway.py`, the sole Home Assistant API wrapper.
- [x] Phase 2 — `controller/commands.py`, the closed Command vocabulary.
- [x] `domain/` rename — `models.py`/`model_conditions.py`/`durations.py`
      moved to `domain/alert_schema.py`/`domain/condition_schema.py`/
      `domain/durations.py`; all callers updated; tests green.
- [x] Phase 3 — pure `controller/features/notification.py` (replaces `delivery/`).
- [x] Phase 4 — pure `controller/features/triggering.py` + `controller/features/confirmation.py`
      (replaces `runtime/engine.py` + `runtime/state.py` +
      `runtime/confirmations.py` + `runtime/drafts.py`).
- [x] Phase 5 — pure `controller/features/follow_up_actions.py` (replaces `runtime/actions.py`).
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

- [ ] **Loosen `domain/alert_schema.py` ownership.** Investigate replacing the
  field-by-field alert normalizer with a small data object or boundary-level
  YAML shape validator. Feature modules should be able to add and own their
  fields without updating one central schema for every change. Preserve the
  guarantees that saved YAML has a valid basic alert structure, unknown feature
  data is retained, and invalid input cannot overwrite the last valid config.
  Decide whether the replacement should use typed core fields plus an
  extensible mapping, or a lightweight document wrapper around the YAML data.
  - [x] Unknown alert and notification fields are now preserved during
    normalization; retired compatibility fields remain explicitly excluded.
    The module still owns shared condition/duration normalization and basic
    YAML safety, so full replacement remains open.
  - [x] A small `AlertEnvelope` dataclass now owns only the shared alert
    boundary; feature-owned fields remain in an extensible `extras` mapping.
  - [x] `ConfigNormalizer` now accepts registered `AlertFeature` hooks so a
    feature can add or normalize its own alert fields without expanding the
    shared field list.
  - [x] Confirmation defaults and mapping now live in the dataclass-backed
    `domain/confirmation_schema.py` feature boundary instead of a private
    helper inside `alert_schema.py`.
  - [ ] **Delegate feature-owned structure:** reduce the shared schema to the
    basic alert document boundary and move feature-specific defaults,
    normalization, and validation into the owning backend features. Apply the
    same rule to notification recipient types: user recipients and Mobile App
    recipients should define and maintain their own structures under
    `controller/notification_services/`, rather than having one central alert
    schema manage both. Preserve extension-field retention and invalid-YAML
    protection while making this change.
    - [x] Target normalization no longer owns a fixed recipient-type allowlist;
      new recipient selectors are retained for `notification_services/` to
      interpret.

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
