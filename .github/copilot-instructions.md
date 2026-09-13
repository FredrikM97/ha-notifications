# Notification Center Copilot Instructions

## Project purpose
This repository is a Home Assistant custom integration named Notification Center. The project should feel like a native Home Assistant feature: simple by default, powerful when needed, and reliable enough to trust.

## Core principles
- Keep the UI compact and native to Home Assistant.
- Preserve working functionality while improving clarity.
- Prefer native HA selectors and patterns over custom controls.
- Treat YAML as a first-class configuration option.
- Validate before claiming a fix is complete.
- Never silently discard valid config or unsaved edits.

## Required behavior for changes
- Verify imports and referenced files actually exist.
- Validate Python syntax after code changes.
- Make frontend changes only when the relevant resource exists and is loaded correctly.
- Favor small, targeted fixes over broad architectural changes.
- Preserve alert behavior across create, edit, delete, enable/disable, save, reload, and runtime update flows.

## Alert and runtime expectations
- Supporting condition-change checks and periodic checks must continue to work.
- Multiple notifications, multiple targets, confirmation flows, and follow-up actions must remain supported.
- Runtime updates after saving must continue to apply without requiring a restart unless explicitly necessary.
- YAML validation must never replace a valid saved configuration with invalid data.

## Quality bar for completion
Before considering a task complete, confirm:
1. Python syntax is valid.
2. Imports and frontend resource references resolve.
3. The save/edit lifecycle still works.
4. The alert still updates at runtime after changes.
5. No regressions were introduced in config or notification behavior.

## Output expectations
When making changes, summarize:
- what changed
- why the change was needed
- what validation was performed
- any remaining risk or follow-up recommendation

## Logic index
Use `.github/logic-index.md` as the first pointer for understanding the integration’s main flows.
Start there to find the relevant models, storage, runtime, frontend, and websocket files before reading deeper.
