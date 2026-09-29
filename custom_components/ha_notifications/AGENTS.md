# Backend Integration

The Python package is the authored Home Assistant integration. Start with
`__init__.py` for setup, config-entry lifecycle, persistence, and automation
reconciliation; use `configuration.py` for the canonical Pydantic-backed alert
shape; use `automation.py` for native automation generation; use
`notification.py` for integration services; and use `bridge/` for websocket
commands and panel registration.

`ConfigEntry.data`/`options` hold persisted configuration. `RuntimeData` in
`domain.py` holds runtime state. Keep those responsibilities separate and
preserve Home Assistant-native extra fields through validation and rendering.

Backend tests and reusable fixtures live in `tests/backend/`. Run a focused
test file plus `python3 -m ruff check custom_components/ha_notifications
tests/backend` when changing this package.