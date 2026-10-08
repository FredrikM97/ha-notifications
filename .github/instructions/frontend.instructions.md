---
description: "Use when changing HA Notifications TypeScript/Lit UI, editor drafts, or frontend API contracts."
applyTo: "frontend/**/*.ts, tests/frontend/**/*.ts, tests/frontend/**/*.tsx"
---

Preserve canonical backend configuration and native HA YAML/extra fields;
do not invent persisted shapes or API contracts. Keep transient drafts separate.
Persist configured values and their enablement together. Disabling a field or
feature must not delete, clear, or move its configured values into session-only
storage. A feature's enablement flag must live with the feature it controls:
`{ enabled, value }` for `conditions.interval` and `reminders.forget_after`,
`{ enabled, items }` for `confirmation.actions` and `post_send_actions`; never a
sibling `periodic` or `*_enabled` flag. Parent disablement preserves child flags.
The frontend reads/writes canonical configuration; the backend decides
which enabled values contribute to generated actions and outgoing notifications.
Feature and field enablement must not disable ordinary editor inputs or child
switches. Only explicit schema `field.disabled` restricts value editing. Nonempty
mobile value writes preserve existing field flags; direct boolean values enable
their declared field, and explicit clearing may mark the field disabled.
Explicitly clearing an input is distinct from disabling it. Missing-translation
and translation fallback behavior belongs in `frontend/localize.ts`.
`frontend/editor/alert-model.ts` owns editor draft initialization/finalization;
backend nested Pydantic feature models own runtime defaults. No defaults endpoint.
`frontend/api.ts` is the only transport boundary: use public `hass.callWS`,
keep the wrapper generic, and let callers own payload/response types.
For unfamiliar HA APIs, consult official developer docs; avoid private internals.

Use native HA elements: `ha-top-app-bar-fixed`, `ha-tab-group`, `ha-card`,
`ha-button`, `ha-icon-button`, `ha-icon-overflow-menu`, `ha-dropdown`, `ha-dialog`,
`ha-settings-row`, `ha-form`, `ha-selector`, and `ha-yaml-editor`.
Use `@mdi/js` icons and HA theme variables (`--primary-text-color`,
`--divider-color`, `--ha-space-*`); custom CSS is layout only.
Reuse `frontend/ui.ts` helpers:
- `toolbar(start, actions, narrow, primary?)` for every card header: leading
  content, icon actions collapsing to a narrow menu, at most one main button.
- `.nc-filters` grid below the toolbar; `NarrowController` measures the element
  at HA's 870px breakpoint (panel/card alike), not viewport media queries.
- `navMenu()` for wide side-list/narrow dropdown navigation, `emptyState()`
  for empty content, and `notify()` for HA snackbar feedback, not custom toasts.
Define editor sections in `frontend/editor/sections.ts` as plain data: a key,
optional parent/toggle path/option group, and `fields(alert)` returning native
HA selectors with a dotted `path` into the draft. `readField()`/`writeField()`
are the single read/write entrypoint; selector-generic conversion (durations,
list defaults, option pruning) lives there, and per-field `read`/`write` only
covers real storage differences (recipient `user_id`, forced automation mode).
Section and option-field enablement go through `isSectionEnabled()`,
`setSectionEnabled()`, `isFieldEnabled()` and `setFieldEnabled()`.
Reads must not initialize optional features; writes initialize definite flags
without altering configured values or child enablement.
Sections carry no labels, help keys or rendering hints. Translations nest by
section and field: `editor.<section>.label|helper` and
`editor.<section>.<field>.label|helper|placeholder|options.<value>|fields.<key>`.
All other UI strings nest the same way (`<key>.label|helper`), never `_help` suffixes.
Hex colors use the editor-only `color_hex` selector (native color picker).
Option-group writes pin the group and field switches first; typing a value or
enabling a field never enables its section.
Presentation components take values and emit composed events; keep section keys,
configuration mappings, and backend transport out of them.
`frontend/editor/index.ts` renders every field through `renderField()`;
selector type alone decides layout (boolean row, large block editor, or scalar
row with help icon and optional field switch). No per-section render methods.
Keep `ha-form` schemas stable between renders (editor schema cache) to prevent
native control rebuilds. Give each one-field `ha-form` only its own named value.
Detailed editor label/help structure is in `editor.instructions.md` (scoped).

Use typed properties/events and explicit state changes. Respect Lit lifecycle;
Use named interfaces for meaningful configuration objects and reused models;
avoid anonymous object intersections such as `Notification & { ... }`. Keep
feature interfaces self-contained instead of extending a base only to inherit
one boolean. Inline small one-use nested groups; do not create wrapper interfaces
for every dictionary or optional group. Use inheritance only for a genuine
shared contract.
Do not create a derived notification model just to redeclare an existing field;
use the shared `Notification` contract and enforce operation requirements at the
validation boundary. Inline single-use leaf shapes in their owning interface.
Keep booleans boolean, arrays arrays, and unions for genuine native alternative
value forms. Open native
HA payload dictionaries may use named index-signature interfaces; do not invent
closed schemas for arbitrary platform extensions. Share conversion input/output
types, but do not assume TypeScript types perform runtime conversion or validation.
Keep related state changes together in meaningful transition methods (load,
edit, save, open), such as `setDraft(value, valid, dirty)`. Prefer direct Lit
reactive properties; group state only when it clarifies a real invariant.
Avoid scattered resets, single-assignment forwarding setters, and generic stores.
Represent an async operation with one explicit status/result state rather than
overlapping loading/success/error booleans. Use Lit reactive state for updates;
avoid scattered manual flag resets and repeated `requestUpdate()` calls.
Keep stale-response and disconnect protection; do not add forwarding-only
state setters or a generic state framework for one request.
clean up listeners, timers, and subscriptions on disconnect. Preserve accessible
names, keyboard operation, focus, localization, and loading/empty/success/error states.
Keep module-level `const styles = css` near the top, before implementation functions.
Prefer meaningful render methods over many local template constants. No nested
ternaries: use `if` branches or render methods for additional decisions.
Return HTML directly; do not store template fragments or assemble mutable CSS
class strings. Use Lit `classMap` directly in class bindings. Keep static
stylesheets in the top-level `css` block, not reconstructed during rendering.
Access properties directly: no property-only wrappers or one-use aliases;
keep locals for captured results, avoided repeated work, or nontrivial clarity.
Never add redundant forwarding-only functions. A helper must own meaningful
behavior or a clear contract, not merely rename another call; extract render
methods around complete UI responsibilities, not individual expressions.
Avoid nested helper functions and closure-based groups of methods. Use module-level
functions for stateless logic; use a class with named methods when related operations
share state or configuration. Keep event/collection callbacks short; move multi-step
logic into named methods instead of nesting lambdas. Do not introduce a class for
a single trivial operation.
Keep behavior/styles near their owner; no single-file folders or single-caller
modules. Split only when a second real owner needs it; avoid new infrastructure.

Follow root implementation-first/test-afterwards order and validation commands.
For frontend test work, load `testing` and `testing-frontend`; reuse
`tests/frontend/conftest.ts` helpers. Review snapshots only for intentional
contract changes; do not load backend skills unless backend tests are involved.
