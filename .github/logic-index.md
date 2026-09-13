# Notification Center logic index

This is a compact map of the integration’s main execution flows and decision points.

## 1. Startup and integration lifecycle
- `custom_components/notification_center/__init__.py`
  - integration setup
  - listener registration
  - runtime update hooks
  - reload behavior
  - initial platform setup

## 2. Configuration and validation flow
- `custom_components/notification_center/config_flow.py`
  - user config editing
  - validation and sanitization
  - creation/edit forms
  - YAML validation and conversion entry points
- `custom_components/notification_center/models.py`
  - alert schema and field definitions
  - config structure used across runtime and UI
- `custom_components/notification_center/durations.py`
  - duration parsing and formatting helpers
- `custom_components/notification_center/model_conditions.py`
  - visual condition to Jinja template compilation
- `custom_components/notification_center/storage.py`
  - load/save to Home Assistant storage
  - persistence safeguards
  - last-known-good config handling
- `custom_components/notification_center/delivery/`
  - `rendering.py`: template rendering and payload cleanup
  - `recipients.py`: recipient registry snapshot and target expansion
  - `mobile_app.py`: Mobile App legacy service resolution
  - `planning.py`: delivery route planning and confirmation delivery validation
  - `dispatch.py`: Home Assistant notify service calls

## 3. Runtime alert lifecycle
- `__init__.py`
  - alert registration
  - setup of active alert objects
  - runtime updates after config changes
- `custom_components/notification_center/notifications.py`
  - notification execution
  - confirmation flow
  - follow-up actions
  - history/debug event generation
- `custom_components/notification_center/runtime/actions.py`
  - post-send and post-confirmation service action rendering/execution
  - draft confirmation action execution
- `custom_components/notification_center/runtime/confirmations.py`
  - confirmation user resolution and completion notification construction/sending
- `custom_components/notification_center/runtime/config_api.py`
  - save, delete, YAML, list, and history runtime API operations
- `custom_components/notification_center/runtime/state.py`
  - alert runtime state defaults
  - repeat/resend due calculation
- `custom_components/notification_center/runtime/drafts.py`
  - editor draft notification session IDs, confirmation actions, and expiry

## 4. Frontend/editor flow
- `custom_components/notification_center/panel.py`
  - panel registration and frontend resource loading
- `custom_components/notification_center/frontend/api.ts`
  - fetch/save/update alert API calls
- `custom_components/notification_center/frontend/editor.ts`
  - visual editor logic
  - new/edit alert state
  - YAML and validation UI behavior
- `custom_components/notification_center/frontend/yaml-view.ts`
  - global YAML load, validation, save, and reload behavior
- `custom_components/notification_center/frontend/types.ts`
  - shared frontend alert, registry, and Home Assistant contracts
- `custom_components/notification_center/frontend/panel.ts`
  - dashboard list, actions, and selection handling
- `custom_components/notification_center/frontend/styles.ts`
  - compact style and layout rules

## 5. API and realtime communication
- `custom_components/notification_center/websocket.py`
  - frontend/backend messages
  - save, reload, update, and history interactions
  - runtime updates pushed to the panel

## 6. Core decision points to understand
When debugging a problem, these are the main places to check:

- Data model: `models.py`
- Stored config safety: `storage.py`
- Validation entry points: `config_flow.py`
- Trigger and condition execution: `__init__.py`, `notifications.py`
- Frontend save and reload behavior: `frontend/api.ts`, `frontend/editor.ts`, `websocket.py`

## 7. Recommended read order
For most bugs, read in this order:
1. `models.py`
2. `storage.py`
3. `config_flow.py`
4. `__init__.py`
5. `notifications.py`
6. `websocket.py`
7. the relevant frontend file (`frontend/editor.ts` or `frontend/panel.ts`)

## 8. Quick symptom mapping
- Save fails or config disappears: `config_flow.py`, `storage.py`, `websocket.py`
- Alert does not trigger: `__init__.py`, `notifications.py`, `models.py`
- Periodic or change-based checks break: `__init__.py`, `notifications.py`, `models.py`
- UI does not reflect new saved values: `frontend/editor.ts`, `frontend/api.ts`, `websocket.py`
- Notification or confirmation not sent: `notifications.py`, `models.py`, `websocket.py`

## 9. Read strategy
- Start with the exact file from the symptom map above.
- Read only the needed section and nearby functions.
- Expand only if the root cause is not clear after the first pass.
- Keep this file as the canonical map for logic discovery.
