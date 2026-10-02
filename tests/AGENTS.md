# Tests

Backend tests use pytest with Home Assistant fixtures and are configured by
`pyproject.toml`; shared canonical fixtures are in `tests/backend/conftest.py`
and `tests/backend/fixtures/`. Frontend tests use Vitest with happy-dom and
shared helpers/fixtures in `tests/frontend/conftest.ts` and
`tests/frontend/fixtures/`.

Keep Syrupy `.ambr` files and Vitest snapshot files as test containers, not as
runtime configuration. The standalone Home Assistant automation fixture is
`tests/backend/fixtures/full_feature_automation.yaml` and must remain valid
top-level YAML when the generated automation contract changes.

Use snapshot tests whenever possible for serialized contracts and complete
generated structures. Treat the snapshot as the primary truth instead of
duplicating the same structure with large assertion blocks; keep ordinary
assertions for focused invariants, validation status, errors, and runtime
behavior that snapshots cannot express well.

In backend integration tests, use the `mock_automation_files` fixture to
prepare and inspect Home Assistant's temporary automation include files.
Avoid inline `open()` calls for this test setup; keep direct `tmp_path` file
operations for tests that specifically verify storage serialization or
rollback behavior.

When snapshotting generated automations, serialize the automation to stable
YAML first so the `.ambr` output remains readable and reflects the format
Home Assistant consumes.

Complete related implementation and test edits before running validation.
Then run the narrowest relevant tests once, followed by any required type,
lint, or build checks. Use `sh scripts/validate.sh` for the full repository
validation gate before handoff; do not rerun unchanged checks after every small
edit.