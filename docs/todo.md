# TODO

This file contains active work only. Completed architecture history is summarized
below; use `docs/architecture.md` and `.github/logic-index.md` for current design
and file routing.

## Active

### 1. Baseline contracts

- [ ] Preserve all 12 websocket command names, payloads, result shapes, and
  frontend API behavior.
- [ ] Record current ordering and failure behavior for delivery, confirmation,
  history, follow-up actions, reload, and unload.
- [ ] Add lifecycle coverage for partial setup failure, setup idempotence,
  reverse unload, watcher cleanup, task cancellation, reload, persistence, and
  invalid YAML protection.
- [ ] Confirm `ha/gateway.py` retains only genuine Home Assistant subscriptions
  and effect calls.

### 2. Feature lifecycle and dependencies

- [ ] Define a small typed feature protocol with `name`, `dependencies`,
  `setup`, and `unload`.
- [ ] Define a narrow typed feature context for gateway capabilities, state,
  sessions, history/delivery interfaces, task registration, and cleanup.
- [ ] Do not expose the whole controller or introduce a service locator.
- [ ] Replace EventBus feature registration in `controller/core.py` with
  concrete feature workflow owners.
- [ ] Validate missing and cyclic dependencies before registering HA effects.
- [ ] Make startup deterministic, unload reverse-ordered, and partial startup
  rollback-safe.
- [ ] Let triggering own watcher registration and cleanup while the gateway
  continues to provide HA watcher primitives.

### 3. Pydantic model boundaries

- [ ] Add explicit Pydantic v2 dependency in `pyproject.toml`.
- [ ] Use `BaseModel`, `Field`, `field_validator`, and `model_validator` for
  feature-owned configuration and domain models.
- [ ] Decide strictness per feature (`extra="forbid"` or compatibility handling)
  and test the decision.
- [ ] Reduce `domain/alert_schema.py` to the shared alert document boundary;
  move feature-specific defaults, normalization, and validation into owning
  features.
- [ ] Convert `domain/confirmation_schema.py` to a Pydantic model while
  preserving `from_mapping()`/`to_mapping()` compatibility during migration.
- [ ] Add feature-owned models for monitoring/repeat settings, notifications,
  confirmations, sessions, follow-up actions, recipients, and workflow results
  as each feature is migrated.
- [ ] Preserve unknown extension fields, aliases, duration coercion, existing
  YAML shape, and `StrEnum.value` when producing YAML mappings.
- [ ] Keep Voluptuous only for Home Assistant websocket transport envelopes.
- [ ] Validate each payload once at its owning feature boundary.
- [ ] Fix or compatibility-wrap stale `models.py` references, including the
  missing `model_conditions.py` reference, only as part of the model migration.

### 4. Delivery and direct notification workflow

- [ ] Create `delivery/` only where it removes real ownership ambiguity.
- [ ] Move notification composition and recipient/channel resolution into
  delivery ownership, preserving compatibility imports during migration.
- [ ] Preserve generic notify and Mobile App routing behavior.
- [ ] Replace notification bus commands and queries with explicit typed calls.
- [ ] Preserve clear-before-send, replacement ordering, recipient resolution,
  confirmation delivery validation, and test error propagation.
- [ ] Remove delivery-specific `CallService`/`RunBatch` execution once direct
  workflow coverage is green.

### 5. Single history owner

- [ ] Make `features/history.py` the sole history owner.
- [ ] Move formatting, append, list, and alert-removal behavior from
  `support/history.py` into that owner.
- [ ] Replace history subscriptions and query calls with explicit methods.
- [ ] Make workflows record history explicitly at defined points.
- [ ] Preserve ordering, filtering, limits, deletion cleanup, persistence, and
  persistence-failure behavior.
- [ ] Retire `support/history.py` after every caller migrates.

### 6. Direct follow-up actions

- [ ] Execute post-send actions directly after successful delivery.
- [ ] Execute post-confirmation actions directly after confirmation effects.
- [ ] Preserve sequential execution, per-action isolation, action indexes, and
  history outcomes.
- [ ] Remove action request/result events and `RunBatch` after migration.

### 7. Direct confirmation workflow

- [ ] Route the Home Assistant notification-action callback directly into the
  confirmation feature.
- [ ] Encapsulate confirmation sessions behind typed methods.
- [ ] Remove session query/event traffic.
- [ ] Preserve draft TTLs, reload reconstruction, stale-action rejection,
  acknowledgement ordering, completion notifications, and test-versus-real
  history behavior.

### 8. Direct triggering workflow

- [ ] Route startup, reload, interval, and template-change callbacks directly
  to triggering workflows.
- [ ] Preserve explicit ordering: evaluate, mutate state, manage confirmation,
  clear if inactive, record history, deliver, record result, run actions, and
  persist.
- [ ] Preserve enable/disable transitions, repeats, watcher replacement, and
  error behavior.
- [ ] Remove condition and notification outcome event cascades after direct
  paths are green.

### 9. Thin websocket transport

- [ ] Keep `bridge/websocket.py` as the Home Assistant transport adapter.
- [ ] Keep feature command declarations separate from HA connection
  serialization and response handling.
- [ ] Do not add a second runtime router unless HA registration requires
  lifecycle metadata.
- [ ] Define consistent exception-to-error-code behavior for all commands.
- [ ] Verify whether HA websocket commands can be unregistered; prevent
  duplicate or stale handlers if they cannot.
- [ ] Add tests for command registration, validation errors, result shapes, and
  reload/unload behavior.

### 10. Remove the private EventBus

- [ ] Confirm every producer and consumer has migrated to direct workflows.
- [ ] Delete `controller/bus.py`.
- [ ] Remove obsolete definitions from `controller/events.py` and
  `controller/commands.py`.
- [ ] Remove gateway bus responders/listeners and feature bus adapters.
- [ ] Replace useful EventBus tests with workflow ordering and failure tests,
  then delete obsolete bus tests.
- [ ] Search for `EventBus`, `bus.ask`, `bus.publish`, `bus.execute`,
  `register_bus_`, `Emit`, and `RunBatch`; only Home Assistant event APIs may
  remain.

### 11. Documentation and validation

- [ ] Update `docs/architecture.md` with direct workflows, feature ownership,
  dependencies, Pydantic boundaries, delivery, and lifecycle.
- [ ] Update `.github/logic-index.md` with current paths and owning symbols.
- [ ] Update `.github/notification-center-context.md` as a concise orientation
  map.
- [ ] Update architecture instructions that still describe the private bus.
- [ ] Verify every documented path exists and stale module names are removed.
- [ ] Run focused tests after each coherent migration slice.
- [ ] Run `python3 -m pytest tests/` at completion.
- [ ] Run `git diff --check`.
- [ ] Run frontend build/tests only when frontend code or contracts change.

### Risks to monitor

- [ ] Event ordering or failure-policy drift.
- [ ] Lost watcher/task cleanup or stale websocket handlers.
- [ ] Duplicate history entries.
- [ ] Invalid YAML overwriting valid configuration.
- [ ] Pydantic coercion changing accepted YAML unexpectedly.
- [ ] Unknown feature fields being silently discarded.
- [ ] Compatibility imports hiding stale EventBus dependencies.
- [ ] Circular dependencies between delivery, triggering, and confirmation.
- [ ] `controller/core.py` becoming a validator or workflow god object again.

### Explicitly out of scope

- [ ] Frontend layout redesign.
- [ ] Websocket command renames or public API changes.
- [ ] Removing Home Assistant's external event bus.
- [ ] Alert semantic changes, recipient UX changes, or confirmation UX changes.
- [ ] YAML format migration or persisted runtime-key migration.
- [ ] Generic application, plugin, dependency-injection, or router frameworks.
- [ ] Broad config-flow changes and unrelated bug fixes.

## Completed Summary

- Reorganized the backend around one Home Assistant gateway, a controller
  kernel, an EventBus, closed commands, and top-level feature modules.
- Moved alert, confirmation, notification, follow-up-action, history, and
  notification-service decisions into their owning `features/` modules.
- Moved shared schemas and duration handling into `domain/`; storage and
  history helpers remain pure under `support/`.
- Split frontend editor sections into `frontend/sections/*.ts`, kept
  `frontend/api.ts` as the transport boundary, and converted shared toast
  rendering to Lit.
- Removed retired runtime, delivery, top-level websocket, and legacy model
  modules; updated tests and architecture documentation.
- Completed recipient routing, confirmation effects, trigger transitions,
  duration controls, edit-view navigation, and invalid-recipient reporting.

## Validation Commands

Backend:

```bash
python3 -m pytest tests/
```

Frontend:

```bash
npm run build
npm run test:frontend
npm run test:unit
```

Run the frontend unit command when changing pure frontend logic covered by
`tests/frontend/*.test.ts`. Update this file only when active work changes.
