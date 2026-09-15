---
description: "Use when refactoring Notification Center architecture, moving modules, changing ownership boundaries, migrating EventBus flows to direct application services, or reorganizing frontend/backend layers."
name: "Notification Center Architecture Refactoring"
---
# Architecture Refactoring

- Start with the current filesystem and symbol definitions. Verify every path, import, and reference before planning a move; do not trust stale names in notes, summaries, or diagrams.
- Read `.github/logic-index.md` and `docs/architecture.md` before changing a boundary. Update both when modules are moved, split, merged, or renamed.
- Give each concern one owner. Keep `controller/core.py` as the lifecycle and composition root, keep Home Assistant access in `ha/gateway.py`, keep frontend transport in `frontend/api.ts`, and place feature decisions in the matching `features/*.py` module.
- Prefer named, typed, awaited application workflows when ordering and ownership are known. Use event publication for genuine one-to-many facts or external event boundaries, not as a substitute for ordinary method calls or dependency injection.
- Evaluate each existing EventBus path on its own merits. Simplify paths whose ordering, state mutation, or failure behavior is clearer as direct orchestration, while retaining event fan-out where it provides meaningful decoupling.
- For broad refactors, work one ownership boundary at a time. During an intentionally breaking intermediate state, use only cheap blocker checks; once the boundary is coherent, run focused tests and verify imports, workflow inputs/results, ordering, persistence, failure behavior, and lifecycle cleanup before continuing.
- Preserve behavior while reorganizing: save/edit/reload, runtime updates, duration serialization, mixed recipient validation, confirmations, and post-send or post-confirmation actions must remain covered.
- Prefer a small compatibility-preserving step when the current contract is unclear. Do not remove compatibility without an explicit migration plan covering all producers, consumers, persisted data, and focused tests.
