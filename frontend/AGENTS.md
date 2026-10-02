# Frontend

The frontend is authored TypeScript/Lit code. `panel.ts` owns the panel/card
entry point, `api.ts` is the Home Assistant websocket transport boundary,
`types.ts` defines frontend contracts, `editor/` owns editor orchestration,
and `panel/` plus `sections/` contain feature rendering.

Keep the canonical backend configuration shape and YAML syntax intact when
editing payload or editor code. Frontend fixtures and behavior tests are in
`tests/frontend/`; snapshots are part of the test contract and should be
updated deliberately.

Keep CSS in the Lit component that owns its markup. Generic shared-style
modules are brittle and can leak changes across unrelated owners; tolerate
small local CSS duplication. Reuse a Lit component when behavior and UI are
shared instead of introducing a CSS-only abstraction.

Use Lit components for cohesive behavior or independently styled regions, not
as wrappers around ordinary semantic HTML. Keep private single-owner components
and their `static styles` in the feature module; split a large view by real UI
responsibilities rather than creating a file for every fragment.

Finish related frontend edits before validating. For a coherent slice, run the
relevant focused Vitest tests and typecheck/build checks together; run the full
frontend/repository suite at the end of the slice or before handoff rather than
after each small edit.