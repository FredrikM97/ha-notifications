---
description: "Frontend-specific boundaries for HA Notifications TypeScript and Lit files."
applyTo: "frontend/**/*.ts, tests/frontend/**/*.ts, tests/frontend/**/*.tsx"
---

Use `frontend/api.ts` as the transport boundary and preserve the canonical
backend configuration shape and YAML syntax. Keep editor orchestration in
`frontend/editor/index.ts` and section UI in `frontend/panel/sections/`.
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

Build controls with semantic HTML, accessible names, keyboard operation, and
visible focus states. Keep layouts usable at narrow widths and ensure loading,
empty, success, and error states are handled where applicable. Reuse localization
helpers for user-facing text; do not hardcode strings in components when the
project has a translation path. Avoid unnecessary dependencies and generic
shared-style modules. CSS-only shared styles are brittle: changes can silently
affect unrelated shadow roots and style owners drift apart. Keep styles with
their Lit component, even when a small declaration is repeated. When UI and
behavior are genuinely reused, reuse a component rather than exporting a
catch-all stylesheet.

Keep shared visual states and semantics in reusable components such as the
shared button template; callers may provide a variant and caller-specific
layout classes. Keep component-specific styles beside the component that owns
the markup and behavior. Extract repeated markup when its callers share
behavior, and split large components at clear presentation or behavior
boundaries instead of growing generic `styles.ts` or `shared-styles.ts` files.

Prefer Lit components for cohesive interactive or independently styled UI, not
for wrapping basic semantic elements such as headings, links, and layout
containers. Give each component its own typed properties, composed events, and
`static styles`; keep single-owner private components in the owning module
rather than creating a file per small part. For component and style ownership:
- Keep each exported stylesheet focused on one component or cohesive rendered
  responsibility; do not combine unrelated selector regions just because their
  templates share a file.
- Use existing render-helper boundaries to identify distinct UI regions. Give
  independently styled or interactive regions their own component and
  `static styles`; keep subtemplates that belong to one component under its
  styles.
- Expose supported style variants through typed properties or CSS custom
  properties consumed by the owning component, not parent selectors that reach
  across component roots.

When changing behavior, cover the user-visible contract with focused tests,
including relevant interaction and failure states. Update snapshots only when
the rendered contract intentionally changes. Run focused Vitest tests first,
then `npm run typecheck` and `npm run build` for frontend changes; run the
repository validation gate before handoff when the change warrants it.

## Frontend Test Patterns

Reuse the typed fixture builders and DOM helpers in `tests/frontend/conftest.ts`
for canonical alerts, form values, Home Assistant state, Lit mounting, queries,
and update settling. Keep one-off scenario data beside its test; promote setup
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
