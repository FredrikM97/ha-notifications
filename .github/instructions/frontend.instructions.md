---
description: "Use when changing HA Notifications TypeScript/Lit UI, editor drafts, or frontend API contracts."
applyTo: "frontend/**/*.ts, tests/frontend/**/*.ts, tests/frontend/**/*.tsx"
---

Preserve canonical backend configuration and native HA YAML/extra fields;
do not invent persisted shapes or API contracts. Keep transient drafts separate.
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
Editor sections are declarative catalog entries in `frontend/editor/sections.ts`.
Keep `ha-form` schemas and `ha-selector` configs stable between renders
(`selectConfig()`, editor schema cache) to prevent native control rebuilds.
Detailed editor label/help structure is in `editor.instructions.md` (scoped).

Use typed properties/events and explicit state changes. Respect Lit lifecycle;
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
Keep behavior/styles near their owner; no single-file folders or single-caller
modules. Split only when a second real owner needs it; avoid new infrastructure.

Follow root implementation-first/test-afterwards order and validation commands.
For frontend test work, load `testing` and `testing-frontend`; reuse
`tests/frontend/conftest.ts` helpers. Review snapshots only for intentional
contract changes; do not load backend skills unless backend tests are involved.
