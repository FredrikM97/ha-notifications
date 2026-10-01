---
name: testing-backend
description: "Use when adding or reviewing HA Notifications Python tests, Home Assistant fixtures, config-entry flows, service calls, automation generation, reconciliation, or backend snapshots."
---
# HA Notifications backend testing

Use this skill for Python and Home Assistant integration tests. Use
`pytest-homeassistant-custom-component` fixtures and real Home Assistant
components first: `hass`, `MockConfigEntry`, `enable_custom_integrations`,
`async_mock_service`, config-entry flows, service calls, event bus, states,
registries, and automation schema validation.

Reuse builders and YAML fixtures from `tests/backend/conftest.py` and the
shared backend setup. Pass fixtures as test parameters instead of rebuilding
the same alert or HA object in each test. Use `pytest.mark.parametrize` or
parameterized fixtures for equivalent trigger, condition, migration, and error
cases. Use Syrupy snapshots for complete generated automation mappings,
canonical payloads, and other serialized contracts; use ordinary assertions
for focused invariants.

Do not make a fake `HomeAssistant`, service registry, config-entry manager, or
event bus when the real fixture can exercise the contract. Use a small local
stub only for a pure function or external protocol boundary that the test does
not own. Tests should verify behavior at the owning integration boundary.

Finish related backend implementation and test edits before running checks.
For a coherent slice, batch focused pytest and Ruff checks; run the full backend
suite or repository gate before handoff instead of after each small edit. When
snapshots change, run the focused test with `--snapshot-update`, inspect the
diff, then validate without update mode. Treat fixture drift, stale imports,
and deleted architecture references as real failures.
