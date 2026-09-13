# Notification Center context map

This file is a lightweight map of the repository so agents can narrow to the right files before reading deeper.

## Primary entry points
- `custom_components/notification_center/__init__.py` — integration setup, runtime registration, update hooks, reload behavior
- `custom_components/notification_center/config_flow.py` — UI config flow and validation logic
- `custom_components/notification_center/storage.py` — persisted alert storage and save/load behavior
- `custom_components/notification_center/models.py` — alert schema and data model
- `custom_components/notification_center/notifications.py` — notification sending and confirmation handling
- `custom_components/notification_center/panel.py` — panel registration and compiled frontend entry point
- `custom_components/notification_center/websocket.py` — runtime frontend/backend communication

## Frontend/editor surfaces
- `custom_components/notification_center/frontend/api.ts` — API calls for listing/saving alerts
- `custom_components/notification_center/frontend/editor.ts` — editor form and alert editing logic
- `custom_components/notification_center/frontend/panel.ts` — dashboard/panel interactions
- `custom_components/notification_center/frontend/styles.ts` — styling and layout

## Runtime and alert execution
- `__init__.py` and `notifications.py` — execution and notification logic
- `storage.py` — config persistence and last-known-good state
- `models.py` — alert definitions and fields
- `config_flow.py` — validation and config conversion

## When changing behavior
1. Identify the subsystem by symptom: config flow, storage, runtime execution, or frontend editing.
2. Start with the closest file in this map.
3. Read only the exact file ranges needed for the issue.
4. Use `.github/logic-index.md` as the canonical flow map for decision points and read order.
5. Only expand to wider reads if the root cause remains unclear.

## Good starting points by task
- Save/edit lifecycle bug: `config_flow.py`, `storage.py`, `websocket.py`
- Runtime trigger or interval issue: `__init__.py`, `notifications.py`, `models.py`
- Panel/editor UI issue: `frontend/editor.ts`, `frontend/panel.ts`, `frontend/api.ts`
- YAML/import or validation issue: `config_flow.py`, `storage.py`, `models.py`
- Notification/confirmation flow: `notifications.py`, `models.py`, `websocket.py`

## Keep it narrow
- Prefer exact reads over broad repo reads.
- Do not read the whole project unless the issue spans multiple subsystems.
- If a change touches both frontend and runtime, check the interface contract in `websocket.py` and the relevant storage/config files before editing broader code.
