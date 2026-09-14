# Notification Center context map

This file is a lightweight map of the repository so agents can narrow to the right files before reading deeper. For a visual component map, see `docs/architecture.md`. For symptom-to-file lookup, see `.github/logic-index.md`.

## Primary entry points
- `custom_components/notification_center/__init__.py` — minimal HA lifecycle glue: builds the controller, calls `async_setup`/`async_unload`, registers the `reload`/`test` services
- `custom_components/notification_center/config_flow.py` — UI config flow and validation logic
- `custom_components/notification_center/controller/core.py` — `NotificationCenterController`: the kernel. Owns the gateway, the generic `Command` dispatcher, setup/reload sequencing, and every public frontend-facing operation
- `custom_components/notification_center/bridge/websocket.py` — the frontend-facing interface: registers the 12 `notification_center/*` websocket commands
- `custom_components/notification_center/bridge/validation.py` — normalizes/validates incoming alert/YAML payloads before they reach the controller
- `custom_components/notification_center/bridge/panel.py` — pure frontend panel registration data (`registration_plan`)
- `custom_components/notification_center/ha/gateway.py` — `HomeAssistantGateway`: the only module that imports `homeassistant.*`

## Controller package (the brain)
- `custom_components/notification_center/controller/alerts.py` — pure: trigger/state-machine logic (when does an alert fire)
- `custom_components/notification_center/controller/responses.py` — pure-ish: confirmation/session tracking and mobile-action-event routing
- `custom_components/notification_center/controller/notifications.py` — pure: composes what to send/clear and to whom
- `custom_components/notification_center/controller/actions.py` — pure: builds post-send/post-confirmation follow-up service calls
- `custom_components/notification_center/controller/commands.py` — the closed `Command` vocabulary `core.py` executes against the gateway

## Shared/support modules
- `custom_components/notification_center/domain/alert_schema.py` — alert schema, `ConfigNormalizer`/`normalize_config`/`normalize_alert`
- `custom_components/notification_center/domain/condition_schema.py` — visual condition rows -> Jinja template string
- `custom_components/notification_center/domain/durations.py` — duration parse/format helpers
- `custom_components/notification_center/support/storage.py` — YAML (de)serialization and state-shape repair
- `custom_components/notification_center/support/history.py` — history entry formatting/query helpers

## Frontend/editor surfaces
- `custom_components/notification_center/frontend/api.ts` — API calls for listing/saving alerts (the only transport boundary)
- `custom_components/notification_center/frontend/panel.ts` — dashboard/panel LitElement shell, tab navigation
- `custom_components/notification_center/frontend/editor/index.ts` — `AlertEditorController`: dialog state, dirty tracking, save/test/validate wiring
- `custom_components/notification_center/frontend/sections.ts` — barrel re-exporting one render function per alert-editor section from `frontend/sections/*.ts` (basic, monitor, condition, recipients, notification, reminder interval, confirmation, post-send/post-confirmation actions)
- `custom_components/notification_center/frontend/editor/helpers.ts` — shared render helpers (`field`, `section`, `codeEditor`, `durationInput`, YAML (de)serialization)
- `custom_components/notification_center/frontend/editor/types.ts` — `EditorContext` and other shared editor types/constants
- `custom_components/notification_center/frontend/condition-builder.ts` — visual condition builder
- `custom_components/notification_center/frontend/recipient-picker.ts` — notification target/recipient picker
- `custom_components/notification_center/frontend/styles.ts` — styling and layout

## When changing behavior
1. Identify the subsystem by symptom: config flow, storage, runtime execution, or frontend editing.
2. Start with the closest file in this map.
3. Read only the exact file ranges needed for the issue.
4. Use `.github/logic-index.md` as the canonical flow map for decision points and read order.
5. Only expand to wider reads if the root cause remains unclear.

## Good starting points by task
- Save/edit lifecycle bug: `config_flow.py`, `support/storage.py`, `bridge/websocket.py`
- Runtime trigger or interval issue: `controller/alerts.py`, `controller/core.py`, `domain/alert_schema.py`
- Panel/editor UI issue: `frontend/editor/index.ts`, `frontend/sections.ts`, `frontend/panel.ts`, `frontend/api.ts`
- YAML/import or validation issue: `config_flow.py`, `support/storage.py`, `domain/alert_schema.py`
- Notification/confirmation flow: `controller/alerts.py`, `controller/notifications.py`, `controller/responses.py`, `bridge/websocket.py`

## Keep it narrow
- Prefer exact reads over broad repo reads.
- Do not read the whole project unless the issue spans multiple subsystems.
- If a change touches both frontend and runtime, check the interface contract in `websocket.py` and the relevant storage/config files before editing broader code.

## After a structural change
If you split, move, or rename a module, update `docs/architecture.md` (diagram) and this file (references) in the same change. A structural PR is not complete until both match reality.
