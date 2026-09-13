# Notification Center logic index

This is a compact map of the integration’s main execution flows and decision points.

## 1. Startup and integration lifecycle
- `__init__.py`
  - integration setup
  - listener registration
  - runtime update hooks
  - reload behavior
  - initial platform setup

## 2. Configuration and validation flow
- `config_flow.py`
  - user config editing
  - validation and sanitization
  - creation/edit forms
  - YAML validation and conversion entry points
- `models.py`
  - alert schema and field definitions
  - config structure used across runtime and UI
- `storage.py`
  - load/save to Home Assistant storage
  - persistence safeguards
  - last-known-good config handling

## 3. Runtime alert lifecycle
- `__init__.py`
  - alert registration
  - setup of active alert objects
  - runtime updates after config changes
- `notifications.py`
  - notification execution
  - confirmation flow
  - follow-up actions
  - history/debug event generation

## 4. Frontend/editor flow
- `panel.py`
  - panel registration and frontend resource loading
- `frontend/src/api.ts`
  - fetch/save/update alert API calls
- `frontend/src/editor.ts`
  - visual editor logic
  - new/edit alert state
  - YAML and validation UI behavior
- `frontend/src/panel.ts`
  - dashboard list, actions, and selection handling
- `frontend/styles.js`
  - compact style and layout rules

## 5. API and realtime communication
- `websocket.py`
  - frontend/backend messages
  - save, reload, update, and history interactions
  - runtime updates pushed to the panel

## 6. Core decision points to understand
When debugging a problem, these are the main places to check:

- Data model: `models.py`
- Stored config safety: `storage.py`
- Validation entry points: `config_flow.py`
- Trigger and condition execution: `__init__.py`, `notifications.py`
- Frontend save and reload behavior: `frontend/src/api.ts`, `frontend/src/editor.ts`, `websocket.py`

## 7. Recommended read order
For most bugs, read in this order:
1. `models.py`
2. `storage.py`
3. `config_flow.py`
4. `__init__.py`
5. `notifications.py`
6. `websocket.py`
7. the relevant frontend file (`frontend/src/editor.ts` or `frontend/src/panel.ts`)

## 8. Quick symptom mapping
- Save fails or config disappears: `config_flow.py`, `storage.py`, `websocket.py`
- Alert does not trigger: `__init__.py`, `notifications.py`, `models.py`
- Periodic or change-based checks break: `__init__.py`, `notifications.py`, `models.py`
- UI does not reflect new saved values: `frontend/src/editor.ts`, `frontend/src/api.ts`, `websocket.py`
- Notification or confirmation not sent: `notifications.py`, `models.py`, `websocket.py`

## 9. Read strategy
- Start with the exact file from the symptom map above.
- Read only the needed section and nearby functions.
- Expand only if the root cause is not clear after the first pass.
- Keep this file as the canonical map for logic discovery.
