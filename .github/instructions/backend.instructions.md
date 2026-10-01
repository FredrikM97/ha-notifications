---
description: "Backend-specific boundaries for HA Notifications Python integration files."
applyTo: "custom_components/ha_notifications/**/*.py, tests/backend/**/*.py"
---

Keep persistent configuration separate from `ConfigEntry.runtime_data`, and
preserve native Home Assistant trigger, condition, template, and action data.
Use existing integration modules and canonical backend fixtures; do not
reintroduce removed architecture or invent frontend-visible contracts.

For test, fixture, snapshot, config-entry, service, automation, or integration
behavior work, load the shared `testing` and `testing-backend` skills. Use a
focused pytest command before broader validation.
