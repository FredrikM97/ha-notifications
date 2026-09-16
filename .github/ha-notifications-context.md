# HA Notifications context map

This file is a lightweight map of the repository so agents can narrow to the right files before reading deeper. `.github/logic-index.md` is the canonical symptom-to-file and flow router; use this file only for orientation. For a visual component map, see `docs/architecture.md`.

## Primary entry points
- `custom_components/ha_notifications/__init__.py` — minimal HA lifecycle glue: builds the controller, calls `async_setup`/`async_unload`, registers the `reload`/`test` services
- `custom_components/ha_notifications/config_flow.py` — UI config flow and validation logic
- `custom_components/ha_notifications/controller/core.py` — `HaNotificationsController`: the composition root. Owns direct Home Assistant lifecycle effects, typed awaited workflow sequencing, direct routing of HA confirmation actions, notification send/clear routing, and every public frontend-facing operation
- `custom_components/ha_notifications/bridge/websocket.py` — the frontend-facing interface: registers the 12 `ha_notifications/*` websocket commands
- `custom_components/ha_notifications/bridge/panel.py` — pure frontend panel registration data (`registration_plan`)

## Controller kernel and feature modules
- `custom_components/ha_notifications/controller/core.py` — kernel: Home Assistant lifecycle effects, setup/reload sequencing, public operations, command interpretation, and notification send/clear routing
- `custom_components/ha_notifications/controller/lifecycle.py` — controller-owned feature dependency validation, setup ordering, rollback, and unload
- `custom_components/ha_notifications/delivery/` — recipient resolution for Home Assistant's generic Notify service
- `custom_components/ha_notifications/domain/service_calls.py` — plain service-call values passed to Home Assistant execution
- `custom_components/ha_notifications/features/conditions.py` — monitor model, condition registration, and alert state-machine decisions
- `custom_components/ha_notifications/features/confirmation.py` — confirmation model, direct confirmation-action workflow, sessions, and confirmation effects
- `custom_components/ha_notifications/features/notification.py` — notification/repeat models, target normalization, and notification composition/delivery decisions
- `custom_components/ha_notifications/features/follow_up_actions.py` — post-send and post-confirmation service calls
- `custom_components/ha_notifications/features/history.py` — explicit history mutation and persistence decisions

## Shared/support modules
- `custom_components/ha_notifications/controller/alert.py` — typed `Alert` and `Configuration` objects used by the controller and storage boundary
- `custom_components/ha_notifications/domain/mapping_model.py` — shared Pydantic mapping serialization and extension-field behavior
- `custom_components/ha_notifications/features/conditions.py` — visual condition model and condition rows -> Jinja template string
- `custom_components/ha_notifications/domain/durations.py` — duration parse/format helpers
- `custom_components/ha_notifications/support/storage.py` — structured config persistence, validation, and state-shape repair
- `custom_components/ha_notifications/features/history.py` — history formatting, queries, deletion cleanup, and recording

## Frontend/editor surfaces
- `frontend/api.ts` — API calls for listing/saving alerts (the only transport boundary)
- `frontend/panel.ts` — dashboard/panel LitElement shell, tab navigation
- `frontend/editor/index.ts` — `AlertEditorController`: dialog state, dirty tracking, save/test/validate wiring
- `frontend/sections.ts` — barrel re-exporting one render function per alert-editor section from `frontend/sections/*.ts` (basic, monitor, condition, recipients, notification, reminder interval, confirmation, post-send/post-confirmation actions)
- `frontend/editor/helpers.ts` — shared render helpers (`field`, `section`, `codeEditor`, `durationInput`)
- `frontend/yaml-view.ts` — frontend-only YAML parsing, formatting, validation, and import/export
- `frontend/editor/types.ts` — `EditorContext` and other shared editor types/constants
- `frontend/condition-builder.ts` — visual condition builder
- `frontend/recipient-picker.ts` — notification target/recipient picker
- `frontend/styles.ts` — styling and layout

## When changing behavior
1. Identify the subsystem by symptom: config flow, storage, runtime execution, or frontend editing.
2. Start with the closest file in this map.
3. Read only the exact file ranges needed for the issue.
4. Use `.github/logic-index.md` as the canonical flow map for decision points and read order.
5. Only expand to wider reads if the root cause remains unclear.

## Good starting points by task
- Save/edit lifecycle bug: `config_flow.py`, `support/storage.py`, `bridge/websocket.py`
- Runtime trigger or interval issue: `features/conditions.py`, `controller/core.py`
- Panel/editor UI issue: `frontend/editor/index.ts`, `frontend/sections.ts`, `frontend/panel.ts`, `frontend/api.ts`
- YAML/import or validation issue: `frontend/yaml-view.ts`, `frontend/api.ts`, `features/configuration.py`, `support/storage.py`
- Notification/confirmation flow: `features/notification.py`, `features/confirmation.py`, `delivery/`, `bridge/websocket.py`

## Keep it narrow
- Prefer exact reads over broad repo reads.
- Do not read the whole project unless the issue spans multiple subsystems.
- If a change touches both frontend and runtime, check the interface contract in `websocket.py` and the relevant storage/config files before editing broader code.

## After a structural change
If you split, move, or rename a module, update `docs/architecture.md` (diagram) and this file (references) in the same change. A structural PR is not complete until both match reality.
