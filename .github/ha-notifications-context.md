# HA Notifications context map

This file is a lightweight map of the repository so agents can narrow to the right files before reading deeper. `.github/logic-index.md` is the canonical symptom-to-file and flow router; use this file only for orientation. For a visual component map, see `docs/architecture.md`.

## Primary entry points
- `backend/__init__.py` — minimal HA lifecycle glue: builds the controller, calls `async_setup`/`async_unload`, registers the `reload`/`test` services
- `backend/config_flow.py` — UI config flow and validation logic
- `backend/controller/core.py` — `HaNotificationsController`: the lifecycle host. Owns direct Home Assistant lifecycle effects, typed awaited workflow sequencing, and shared runtime state; feature-owned websocket routes are registered through the lifecycle.
- `backend/bridge/websocket.py` — the frontend-facing interface: registers the 12 `ha_notifications/*` websocket commands
- `backend/bridge/panel.py` — pure frontend panel registration data (`registration_plan`)

## Controller kernel and feature modules
- `backend/controller/core.py` — kernel: Home Assistant lifecycle effects, setup/reload sequencing, public operations, command interpretation, and notification send/clear routing
- `backend/controller/lifecycle.py` — controller-owned feature dependency validation, setup ordering, rollback, and unload
- `backend/delivery/` — recipient resolution for Home Assistant's generic Notify service
- `backend/domain/service_calls.py` — plain service-call values passed to Home Assistant execution
- `backend/features/conditions.py` — monitor model, condition registration, and alert state-machine decisions
- `backend/features/confirmation.py` — confirmation model, direct confirmation-action workflow, sessions, and confirmation effects
- `backend/features/notification.py` — notification/repeat models, target normalization, and notification composition/delivery decisions
- `backend/features/follow_up_actions.py` — post-send and post-confirmation service calls
- `backend/features/history.py` — explicit history mutation and persistence decisions

## Shared/support modules
- `backend/features/configuration.py` — typed `Alert`, `Configuration`, and `AlertRuntime` objects used by feature workflows and the storage boundary
- `backend/domain/template_values.py` — shared recursive template rendering and null removal for service-call configuration
- `backend/features/conditions.py` — visual condition model and condition rows -> Jinja template string
- `backend/domain/durations.py` — duration parse/format helpers
- `backend/support/storage.py` — structured config persistence, validation, and state-shape repair
- `backend/features/history.py` — history formatting, queries, deletion cleanup, and recording

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
- Save/edit lifecycle bug: `backend/config_flow.py`, `backend/support/storage.py`, `backend/bridge/websocket.py`
- Runtime trigger or interval issue: `backend/features/conditions.py`, `backend/controller/core.py`
- Panel/editor UI issue: `frontend/editor/index.ts`, `frontend/sections.ts`, `frontend/panel.ts`, `frontend/api.ts`
- YAML/import or validation issue: `frontend/yaml-view.ts`, `frontend/api.ts`, `backend/features/configuration.py`, `backend/support/storage.py`
- Notification/confirmation flow: `backend/features/notification.py`, `backend/features/confirmation.py`, `backend/delivery/`, `backend/bridge/websocket.py`

## Keep it narrow
- Prefer exact reads over broad repo reads.
- Do not read the whole project unless the issue spans multiple subsystems.
- If a change touches both frontend and runtime, check the interface contract in `websocket.py` and the relevant storage/config files before editing broader code.

## After a structural change
If you split, move, or rename a module, update `docs/architecture.md` (diagram) and this file (references) in the same change. A structural PR is not complete until both match reality.
