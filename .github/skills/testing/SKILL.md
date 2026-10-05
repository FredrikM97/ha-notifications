---
name: testing
description: "Use when adding or reviewing HA Notifications backend/frontend tests, fixtures, snapshots, config-entry flows, service calls, automation generation, or Home Assistant integration behavior."
---
# HA Notifications testing

Use this skill whenever a task changes or reviews tests, fixtures, snapshots,
config-entry flows, Home Assistant service calls, automation generation, or
frontend/backend contract behavior. It is shared procedure, not an
implementation owner: `Lead` applies the relevant backend and frontend
sections and checks the integrated result. Do not load it for a source-only
change with no test or validation impact.

## Backend

Use the real Home Assistant fixtures in `tests/backend/conftest.py` first: `hass` (a
real core on an isolated config dir, bootstrapped with Home Assistant's own
startup code), `enable_custom_integrations`, `MockConfigEntry`,
`async_mock_service`, plus config-entry flows, service calls, event bus,
states, registries, and automation schema validation. Tests depend on
`homeassistant` directly; do not add `pytest-homeassistant-custom-component`.
Register test event listeners with `@callback` (or wrap them), and wait on real
outcomes rather than single event-loop ticks. Reuse builders and YAML fixtures
from `tests/backend/conftest.py` and the repository's shared test setup. Use
pytest fixtures as test parameters instead of rebuilding the same alert or HA
object in each test. Use `pytest.mark.parametrize` or parameterized fixtures
for equivalent trigger, condition, migration, and error cases. Use Syrupy
snapshots for complete generated automation mappings, canonical payloads, and
other serialized contracts; use ordinary assertions for focused invariants.
Do not make a fake `HomeAssistant`,
service registry, config-entry manager, or event bus when the real fixture can
exercise the contract.

Use a small local stub only for a pure function or an external protocol boundary
that the test does not own. Tests should verify behavior at the owning
integration boundary, not implementation details.

## Frontend

Reuse `tests/frontend/conftest.ts`, JSON fixtures, shared query helpers, and
`user-event`. Use ordinary assertions for focused invariants and side effects;
use Vitest snapshots for complete serialized payloads or rendered contracts.
Mock only the transport boundary when testing UI behavior, and keep frontend
payloads aligned with the backend canonical schema.

## Validation

Run focused tests immediately after a change. For a coherent backend slice run
`python3 -m pytest tests/`; for a coherent frontend slice run `npm run
typecheck`, focused Vitest tests, `npm run build`, and the relevant full Vitest
suite. When snapshots change, run the focused test with
`--snapshot-update`, inspect the diff, then rerun without update mode. Treat
fixture drift, stale imports, and deleted architecture references as real
failures, not reasons to weaken the test.
