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

Finish related frontend implementation and test edits before running checks.
For a coherent slice, batch the focused Vitest tests with `npm run typecheck`
and `npm run build`; run the relevant full suite or repository gate before
handoff. Do not rerun unchanged checks after each small edit. When snapshots
change, update them deliberately, inspect the diff, then validate without
update mode. Treat fixture drift, stale imports, and deleted architecture
references as real failures.
