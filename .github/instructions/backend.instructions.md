---
description: "Use when changing HA Notifications Python configuration, runtime, automation, services, or websocket contracts."
applyTo: "custom_components/ha_notifications/**/*.py, tests/backend/**/*.py"
---

`ConfigEntry.data`/`options` persist configuration; `ConfigEntry.runtime_data`
(`RuntimeData` in `domain.py`) owns runtime state. Do not mix them.
Nested Pydantic feature models in `configuration.py` own runtime defaults;
frontend owns editor draft initialization. Do not add a backend defaults endpoint.
Preserve native HA trigger, condition, template, action, and extra fields
through validation/rendering; generated automations derive from canonical alerts.
Preserve disabled configured values in storage. Apply feature and notification
option enablement only when generating runtime actions or native delivery payloads;
do not rely on the frontend to remove disabled values before saving.
Keep each feature's enablement flag with the feature it controls. Switch-plus-value
settings are grouped: `monitor.conditions.interval` and `confirmation.reminders.forget_after`
use `{ enabled, value }`; `confirmation.actions` and `post_send_actions` use
`{ enabled, items }`. Never add sibling flags such as `periodic` or `*_enabled`.
Parent disablement must preserve child enablement and values.
Use existing integration modules; establish frontend-visible contracts across
both owners and `tests/contracts/`, not ad hoc response shapes.
For owners, nearest tests, and pytest/ruff/gate commands, use the root table.
For backend test work, load `testing` and `testing-backend`; use real HA core
fixtures in `tests/backend/conftest.py` before pure units or local stubs.
