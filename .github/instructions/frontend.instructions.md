---
description: "Frontend-specific boundaries for HA Notifications TypeScript and Lit files."
applyTo: "frontend/**/*.ts, tests/frontend/**/*.ts, tests/frontend/**/*.tsx"
---

Use `frontend/api.ts` as the transport boundary and preserve the canonical
backend configuration shape and YAML syntax. Keep editor orchestration in
`frontend/editor/index.ts` and section UI in `frontend/panel/sections/`.
Prefer Home Assistant native selectors and stable literal types. Do not change
persisted shape or invent backend contracts without Lead establishing them.

For test or fixture changes, load `testing-frontend` only when needed and use
focused Vitest validation before broader checks.
