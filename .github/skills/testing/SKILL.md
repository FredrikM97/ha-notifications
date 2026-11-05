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

Use Home Assistant's official `pytest-homeassistant` fixtures first: `hass`,
config-entry flows, service calls, event bus, states, registries, and automation
schema validation. Import `MockConfigEntry` and `async_mock_service` from
`pytest_homeassistant.common` and specify config-entry versions explicitly.
Custom integrations are enabled by default. The local `hass_config_dir` fixture
in `tests/backend/conftest.py` provides isolated writable files; keep local
fixtures integration-specific. Upgrade the plugin pin to update its matching
Home Assistant and pytest dependencies. Do not install the overlapping
`pytest-homeassistant-custom-component` plugin.
Register test event listeners with `@callback` (or wrap them), and wait on real
outcomes rather than single event-loop ticks. Reuse builders and YAML fixtures
from `tests/backend/conftest.py` and the repository's shared test setup. Use
pytest fixtures as test parameters instead of rebuilding the same alert or HA
object in each test. Use `pytest.mark.parametrize` or parameterized fixtures
for equivalent trigger, condition, migration, and error cases. Follow the
snapshot-first and overlap-consolidation policy in `tests/AGENTS.md`: use Syrupy
for complete observable contracts, not field-by-field expected mappings.
Keep focused assertions only for behavior snapshots cannot prove.
Do not make a fake `HomeAssistant`,
service registry, config-entry manager, or event bus when the real fixture can
exercise the contract.

Use a small local stub only for a pure function or an external protocol boundary
that the test does not own. Tests should verify behavior at the owning
integration boundary, not implementation details.

## Frontend

Reuse `tests/frontend/conftest.ts`, JSON fixtures, shared query helpers, and
`user-event`. Follow `tests/AGENTS.md`: prefer Vitest snapshots for complete
serialized payloads or rendered contracts, consolidate overlapping tests, and
retain focused assertions for behavior snapshots cannot prove.
Mock only the transport boundary when testing UI behavior, and keep frontend
payloads aligned with the backend canonical schema.

## Validation

Finish implementation changes first, then add or update tests and run focused
checks. Do not interleave test authoring or test execution with unfinished
implementation. For a coherent backend slice run
`python3 -m pytest tests/`; for a coherent frontend slice run `npm run
typecheck`, focused Vitest tests, `npm run build`, and the relevant full Vitest
suite. When snapshots change, run the focused test with
`--snapshot-update`, inspect the diff, then rerun without update mode. Treat
fixture drift, stale imports, and deleted architecture references as real
failures, not reasons to weaken the test.
