---
description: "Frontend-specific boundaries for HA Notifications TypeScript and Lit files."
applyTo: "frontend/**/*.ts, tests/frontend/**/*.ts, tests/frontend/**/*.tsx"
---

Use `frontend/api.ts` as the transport boundary and preserve the canonical
backend configuration shape and YAML syntax. Keep editor orchestration and
section UI in `frontend/editor/`, dashboard tab views in `frontend/views/`, and
panel state/action coordination in `frontend/panel.ts`.
Prefer Home Assistant native selectors and stable literal types. Do not change
persisted shape or invent backend contracts without Lead establishing them.
For Home Assistant-specific frontend APIs, consult the official developer
documentation and prefer supported public interfaces over private internals.

Act as the frontend owner for the Lit/TypeScript experience: keep behavior,
rendering, styles, and tests close to the feature that owns them, and follow
existing component and Home Assistant patterns before introducing abstractions.
Use typed properties and events, keep transient UI state separate from
canonical alert data, and make state changes explicit. Respect Lit lifecycle
and clean up listeners, timers, and subscriptions when components disconnect.

Build UI from Home Assistant's own elements (`ha-card`, `ha-button`,
`ha-icon-button`, `ha-icon-overflow-menu`, `ha-dropdown`, `ha-dialog`,
`ha-settings-row`, `ha-form`, `ha-selector`, `ha-yaml-editor`,
`ha-top-app-bar-fixed`, `ha-tab-group`) and HA theme variables; keep custom CSS
to layout. Reuse the generic helpers in `frontend/ui.ts` instead of
re-implementing them per view:
- `toolbar()` for every card header: leading content, icon actions that
  collapse into a menu on narrow screens, at most one main button.
- `.nc-filters` grid for filter controls under the toolbar.
- `NarrowController` for responsive layout (HA's 870px breakpoint, measured on
  the element so the panel and the Lovelace card behave alike).
- `navMenu()` for section navigation, `emptyState()`, and `notify()` for
  feedback through HA's snackbar.
Editor sections are declarative `ha-form` schemas in
`frontend/editor/sections.ts`. Keep selector and schema objects stable between
renders (`selectConfig()`, the editor's schema cache) or HA rebuilds the control.

Keep accessible names and keyboard operation, and handle loading, empty,
success, and error states. Reuse localization helpers for user-facing text.
Place boolean field help icons immediately after the label text, not after
the switch or checkbox or at the end of the row. Reuse the editor's shared
`labelWithHelp()` template: a `.nc-heading` containing a label-text span followed
immediately by its info icon. Boolean rows use `.nc-option.nc-option-inline`
with a separate trailing `ha-switch`, not a `ha-settings-row` heading slot.
Keep `.nc-heading` inline-flex with a small gap and content-sized children;
the switch, not the info icon, absorbs the remaining row space. Do not duplicate
native form labels or manipulate private shadow DOM.
Section help belongs immediately to the right of the section heading, via
`sectionHelp()` and the shared label/help template. Never embed section info in
a code editor or place it beside the editor. Notification template-values help
belongs beside the Notification `h2`, not beside its message field. Preserve
other field-specific text helper layouts. Test the visible shared structure:
label-text span then help icon inside `.nc-heading`, switch outside that label,
and section-heading help with no duplicate message-field help.
Do not create a folder for one file or a module with one caller: keep code next
to its only user and split only when a second real owner appears.

When changing behavior, cover the user-visible contract with focused tests,
including relevant interaction and failure states. Update snapshots only when
the rendered contract intentionally changes. Run focused Vitest tests first,
then `npm run typecheck` and `npm run build` for frontend changes; run the
repository validation gate before handoff when the change warrants it.

## Frontend Test Patterns

Reuse the typed fixture builders and DOM helpers in `tests/frontend/conftest.ts`
for canonical alerts, Home Assistant state, Lit mounting, and update settling.
Keep one-off scenario data beside its test; promote setup
to a shared fixture only when multiple suites need the same contract. Use
Vitest `it.each` for equivalent behavior across input scenarios instead of
copying test bodies. For Lit elements, mount the registered custom element,
await `updateComplete` (or the shared settle helper), interact through
`user-event`, and clean the DOM after each test. Snapshot complete stable UI,
payload, and serialized contracts; retain focused assertions for invariants,
events, errors, and side effects that explain behavior more clearly than a
snapshot.

## Frontend Change Checklist

1. Find the owning component, its callers, related types, API boundary, and
	nearest tests before editing. Keep changes in authored `frontend/` sources;
	do not hand-edit generated bundles.
2. State the user-visible behavior and the data it reads or changes. Preserve
	backend contracts and keep temporary interaction state out of saved alert
	configuration.
3. Make the smallest change at the owning boundary. Check loading, empty,
	success, and error states as relevant, plus keyboard use, focus, narrow
	layouts, and cleanup of listeners or other resources.
4. Add or update focused tests for the changed behavior and its important edge
	cases. Review snapshot changes rather than accepting them mechanically.
5. Run the focused Vitest tests, `npm run typecheck`, and `npm run build` for
	frontend changes. Review `git diff` for unintended contract, generated-file,
	or unrelated changes before handoff.

## References

- [Home Assistant frontend developer documentation](https://developers.home-assistant.io/docs/frontend/)
- [Home Assistant frontend source and tests](https://github.com/home-assistant/frontend) (implementation examples; internal APIs are not a compatibility contract)
- [Lit component lifecycle](https://lit.dev/docs/components/lifecycle/)
- [Lit properties](https://lit.dev/docs/components/properties/)
- [Lit events](https://lit.dev/docs/components/events/)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)

For test, fixture, snapshot, UI, or API contract work, load the shared
`testing` and `testing-frontend` skills. Use focused Vitest validation before
broader checks. For behavior spanning backend and frontend, Lead should also
load `testing-backend` and validate the integrated contract.
