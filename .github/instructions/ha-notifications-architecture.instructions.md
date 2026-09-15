---
description: "Use when refactoring HA Notifications architecture, moving modules, changing ownership boundaries, migrating EventBus flows to direct application services, or reorganizing frontend/backend layers."
name: "HA Notifications Architecture Refactoring"
---
# Architecture Refactoring

- Start with the current filesystem and symbol definitions. Verify every path, import, and reference before planning a move; do not trust stale names in notes, summaries, or diagrams.
- Read `.github/logic-index.md` and `docs/architecture.md` before changing a boundary. Update both when modules are moved, split, merged, or renamed.
- Give each concern one owner. Keep `controller/core.py` as the lifecycle host, keep frontend transport in `frontend/api.ts`, and place feature decisions in the matching `features/*.py` module.
- Feature classes may access the Home Assistant instance directly for their own listeners, services, timers, templates, registries, storage, and lifecycle effects. Do not preserve a gateway wrapper merely to hide direct framework calls.
- `@route` and `@websocket_route` are frontend transport declarations only. Backend workflows must call declared class dependencies directly; they must not dispatch internal work by route name.
- Do not use a `FeatureServices`, service-locator, callback bag, or equivalent mutable capability aggregate. Feature constructors receive only their explicit class dependencies and state-machine objects.
- `controller/core.py` must never construct, initialize, configure, or unload individual features. A dedicated lifecycle/composition class discovers and owns feature instances, their dependencies, and their setup order.
- `support/storage.py` owns configuration loading and saving. Core may request a configuration workflow, but must not parse, validate, read, or write configuration documents itself.
- Scheduling is an independent lifecycle-managed component. Features own their scheduled jobs and cancel them during their unload; core must not maintain a generic task set or expose a scheduling callback.
- The test feature owns saved and draft test payload delivery, draft expiry, disposal, and its websocket routes. Confirmation owns only confirmation sessions and external notification-action resolution.
- Prefer named, typed, awaited application workflows when ordering and ownership are known. Use event publication for genuine one-to-many facts or external event boundaries, not as a substitute for ordinary method calls or dependency injection.
- Evaluate each existing EventBus path on its own merits. Simplify paths whose ordering, state mutation, or failure behavior is clearer as direct orchestration, while retaining event fan-out where it provides meaningful decoupling.
- For broad refactors, work one ownership boundary at a time. During an intentionally breaking intermediate state, use only cheap blocker checks; once the boundary is coherent, run focused tests and verify imports, workflow inputs/results, ordering, persistence, failure behavior, and lifecycle cleanup before continuing.
- Preserve behavior while reorganizing: save/edit/reload, runtime updates, duration serialization, mixed recipient validation, confirmations, and post-send or post-confirmation actions must remain covered.
- Prefer a single canonical contract when the ownership boundary is explicit. Do not retain legacy schema aliases or compatibility paths for a deliberate breaking schema rework; migrate all producers, consumers, persisted examples, and focused tests together.
