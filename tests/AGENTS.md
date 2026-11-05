# Tests

Backend tests use the official `pytest-homeassistant` plugin and are configured by
`pyproject.toml`. Use its `hass` fixture and import `MockConfigEntry` and
`async_mock_service` from `pytest_homeassistant.common`; custom integrations are
enabled by default. Specify config-entry versions explicitly. The local
`hass_config_dir` fixture provides an isolated writable directory.
Shared canonical fixtures are in `tests/backend/conftest.py`
and `tests/backend/fixtures/`. Frontend tests use Vitest with happy-dom and
shared helpers/fixtures in `tests/frontend/conftest.ts` and
`tests/frontend/fixtures/`.

Keep Syrupy `.ambr` files and Vitest snapshot files as test containers, not as
runtime configuration. The standalone Home Assistant automation fixture is
`tests/backend/fixtures/full_feature_automation.yaml` and must remain valid
top-level YAML when the generated automation contract changes.

Make snapshots the default for complete payloads, response envelopes, generated
structures, service-call sequences, and stable rendered contracts. Avoid
field-by-field assertions or inline expected mappings that duplicate a snapshot;
compare the complete observable output once. Snapshots still require an assertion
(`assert actual == snapshot` in pytest). Keep focused assertions for timing,
authorization, no-write/no-delivery guarantees, identity, mutation, and other
behavior a static snapshot cannot prove.

Consolidate overlapping tests at the strongest real boundary, preferring official
`pytest-homeassistant` fixtures over local doubles. Remove weaker duplicate tests
only after their distinct cases/invariants are covered by the retained test.
Parameterize genuinely different behavior; do not multiply cases or add tests
solely to repeat defaults, individual keys, or an already snapshotted contract.
Do not reduce coverage just to reduce test counts. Normalize only unstable IDs or
timestamps, preserving meaningful types, fields, ordering, and values. Review
snapshot changes against the intended behavior; never blindly accept updates.

In backend integration tests, use the `automation_api` fixture: it serves
Home Assistant's real admin automation config view, so `sync_entry` writes
generated automations through the API exactly like the frontend. Use
`prepare` to seed HA's default automation storage and `stored` to inspect it.
It uses the upstream authenticated HTTP client and removes the automations it
writes on teardown. Backend snapshots live in `tests/backend/snapshots/`.

Use `hass_ws_client` and upstream user/token fixtures for websocket authorization
and response-envelope tests. Use the config-entry flow and lifecycle managers
for registration, migration, reload, and unload coverage; keep direct calls for
focused unit behavior. `mock_notification_dependencies` stubs only unrelated
sidebar/frontend and mobile-app setup in manager-driven tests.

Use `freezer` with `async_fire_time_changed` for timed behavior rather than wall-clock
sleeps. Advance beyond minted HTTP tokens' issue time, not backwards. The time helper
includes HA's scheduling jitter; leave enough room in pre-boundary assertions.
For automations waiting for confirmation, wait on history outcomes rather than
draining all HA tasks before advancing time. Use `hass_storage` for persistence
round trips and retention boundaries. Use `history_mock` for spec-constrained
service-boundary assertions.

When snapshotting generated automations, serialize the automation to stable
YAML first so the `.ambr` output remains readable and reflects the format
Home Assistant consumes.

Complete related implementation and test edits before running validation.
Then run the narrowest relevant tests once, followed by any required type,
lint, or build checks. Use `sh scripts/validate.sh` for the full repository
validation gate before handoff; do not rerun unchanged checks after every small
edit.