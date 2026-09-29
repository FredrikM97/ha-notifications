---
name: testing-frontend
description: "Use when adding or reviewing HA Notifications TypeScript and Lit tests, frontend fixtures, Vitest snapshots, API transport, editor behavior, or UI contracts."
---
# HA Notifications frontend testing

Use this skill for TypeScript, Lit, editor, dashboard, and transport tests.
Reuse `tests/frontend/conftest.ts`, JSON fixtures, shared query helpers, and
`user-event`.

Use ordinary assertions for focused invariants and side effects. Use Vitest
snapshots for complete serialized payloads, rendered contracts, and stable UI
structures. Mock only the transport boundary when testing UI behavior, and keep
frontend payloads aligned with the backend canonical schema.

Run focused tests immediately after a change. For a coherent frontend slice
run `npm run typecheck`, focused Vitest tests, `npm run build`, and the relevant
full Vitest suite. When snapshots change, update them deliberately, inspect the
diff, then rerun without update mode. Treat fixture drift, stale imports, and
deleted architecture references as real failures.
