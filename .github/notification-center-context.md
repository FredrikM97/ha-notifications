# Notification Center context map

This file is a lightweight map of the repository so agents can narrow to the right files before reading deeper.

## Primary entry points
- `__init__.py` — integration setup, runtime registration, update hooks, reload behavior
- `config_flow.py` — UI config flow and validation logic
- `storage.py` — persisted alert storage and save/load behavior
- `models.py` — alert schema and data model
- `notifications.py` — notification sending and confirmation handling
- `panel.py` and `frontend.py` — panel registration and frontend entry points
- `websocket.py` — runtime frontend/backend communication

## Frontend/editor surfaces
- `frontend/api.js` — API calls for listing/saving alerts
- `frontend/editor.js` — editor form and alert editing logic
- `frontend/panel.js` — dashboard/panel interactions
- `frontend/styles.js` — styling and layout

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
- Panel/editor UI issue: `frontend/editor.js`, `frontend/panel.js`, `frontend/api.js`
- YAML/import or validation issue: `config_flow.py`, `storage.py`, `models.py`
- Notification/confirmation flow: `notifications.py`, `models.py`, `websocket.py`

## Keep it narrow
- Prefer exact reads over broad repo reads.
- Do not read the whole project unless the issue spans multiple subsystems.
- If a change touches both frontend and runtime, check the interface contract in `websocket.py` and the relevant storage/config files before editing broader code.
