# AGENTS.md

## Project role
You are working in Notification Center, a Home Assistant custom integration for alert management, notifications, confirmation flows, periodic checks, and runtime service behavior. The project should feel native to Home Assistant: compact, clear, reliable, and powerful when needed.

## Operating principles
- Keep the UI compact and Home Assistant-native.
- Preserve existing behavior while improving clarity.
- Prefer built-in Home Assistant selectors and patterns over custom controls.
- Treat YAML as a first-class option, not as a secondary format.
- Validate before claiming a fix is complete.
- Never silently discard valid config or unsaved edits.

## Read strategy
Before changing code, follow this order:
1. Read `.github/logic-index.md` to find the relevant subsystem.
2. Read the specific file(s) implicated by the issue.
3. Read only the minimal additional context needed to confirm the root cause.
4. Avoid broad repo reads unless the issue spans multiple subsystems.

## Main subsystem map
- `models.py` — alert schema and data model
- `storage.py` — persistence and saved config handling
- `config_flow.py` — validation and config editing
- `__init__.py` — runtime startup, scheduling, and updates
- `notifications.py` — notifications, confirmations, actions, history
- `websocket.py` — frontend/backend communication
- `frontend/editor.js` — visual editor behavior
- `frontend/panel.js` — dashboard and actions
- `frontend/api.js` — save/load API usage

## Required behavior for changes
- Verify imports and referenced files actually exist.
- Validate Python syntax after code changes.
- Only change frontend files when the relevant resource is present and loaded correctly.
- Favor small targeted fixes over architectural churn.
- Preserve behavior across create, edit, delete, enable/disable, save, reload, and runtime update flows.

## Runtime and alert expectations
- Condition-change checks and periodic checks must continue to work.
- Multiple notifications and targets must remain supported.
- Confirmation flows and follow-up actions must still function.
- Runtime updates after saving must continue to apply without an unnecessary restart.
- YAML validation must never replace a valid saved configuration with invalid data.

## Completion bar
Before considering a task complete, confirm:
1. Python syntax is valid.
2. Imports and frontend resource references resolve.
3. The save/edit lifecycle still works.
4. The alert still updates at runtime after changes.
5. No regression was introduced in config or notification behavior.

## Output expectations
When changing code, summarize:
- what changed
- why it was needed
- what validation was performed
- any remaining risk or follow-up recommendation

## Final rule
Do not optimize for cleverness at the expense of reliability. Prefer a small, correct, Home Assistant-native fix over a broad rewrite.
