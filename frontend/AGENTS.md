# Frontend

The frontend is authored TypeScript/Lit code. `panel.ts` owns the panel/card
entry point, `api.ts` is the Home Assistant websocket transport boundary,
`types.ts` defines frontend contracts, `editor/` owns editor orchestration,
and `panel/` plus `sections/` contain feature rendering.

Keep the canonical backend configuration shape and YAML syntax intact when
editing payload or editor code. Frontend fixtures and behavior tests are in
`tests/frontend/`; snapshots are part of the test contract and should be
updated deliberately.

Use `npm run typecheck` for type validation, `npm run build` for bundling, and
`npx vitest run tests/frontend/api.test.ts` for a focused test.