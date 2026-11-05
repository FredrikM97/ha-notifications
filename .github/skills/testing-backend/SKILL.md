---
name: testing-backend
description: "Use when adding or reviewing HA Notifications Python tests, Home Assistant fixtures, config-entry flows, service calls, automation generation, reconciliation, or backend snapshots."
---
# HA Notifications backend testing

Use this skill for Python and Home Assistant integration tests. Use the official
`pytest-homeassistant` fixtures first: `hass`, config-entry flows, service calls,
event bus, states, registries, and automation schema validation. Import
`MockConfigEntry` and `async_mock_service` from `pytest_homeassistant.common`;
specify config-entry versions explicitly rather than relying on upstream defaults.
Custom integrations are enabled by default. The local `hass_config_dir` fixture
in `tests/backend/conftest.py` provides isolated writable files; keep local
fixtures integration-specific. Upgrade the plugin pin to update its matching
Home Assistant and pytest dependencies. Do not install the overlapping
`pytest-homeassistant-custom-component` plugin.
Register test event listeners with `@callback` (or wrap them), and wait on real
outcomes rather than single event-loop ticks.

Reuse builders and YAML fixtures from `tests/backend/conftest.py` and the
shared backend setup. Pass fixtures as test parameters instead of rebuilding
the same alert or HA object in each test. Use `pytest.mark.parametrize` or
parameterized fixtures for equivalent trigger, condition, migration, and error
cases. Follow the snapshot-first and overlap-consolidation policy in
`tests/AGENTS.md`: prefer Syrupy snapshots for complete observable contracts,
avoid duplicated field-by-field assertions, and retain focused assertions for
behavior snapshots cannot prove. Remove weaker duplicate tests only after
preserving their distinct cases at the stronger HA boundary.

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
