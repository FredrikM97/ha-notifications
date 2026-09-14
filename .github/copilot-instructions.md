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
- Put new logic in the module that already owns that concern (see
  `docs/architecture.md`); do not grow `controller/core.py` or `editor/index.ts`
  back into god-objects. Trigger/state-machine logic belongs in
  `controller/alerts.py`; confirmation-action routing belongs in
  `controller/responses.py`; alert-editor section UI belongs in
  `frontend/sections.ts`.
- Keep the frontend authored with Lit. `frontend/panel.ts` is the LitElement
  shell, and child views should use Lit templates/rendering rather than ad-hoc
  DOM HTML construction.
- Keep `frontend/api.ts` as the only frontend/backend transport boundary. UI
  modules call typed API wrappers instead of constructing websocket messages or
  calling `hass.connection.sendMessagePromise` directly.
- Keep delivery layered: `controller/notifications.py` decides message
  content/recipients/route and returns `Command`s, `controller/actions.py`
  builds post-send/post-confirmation service calls, and only
  `controller/core.py` executes `Command`s against `ha/gateway.py`.
- Prefer straightforward `if` blocks over ternary/conditional-expression
  style for anything with real branching logic. A simple, non-nested
  two-branch expression (e.g. `"Enabled" if enabled else "Disabled"`) may use
  a ternary; never chain/nest ternaries - use an `if` block instead once a
  third branch or nested condition appears.
- Prefer the available VS Code/search tools or `rg` for read-only discovery.
  Avoid `grep`, interactive commands, and commands that require manual approval
  when an available tool or non-interactive command can do the job.

## Alert and runtime expectations
- Supporting condition-change checks and periodic checks must continue to work.
- Multiple notifications, multiple targets, confirmation flows, and follow-up actions must remain supported.
- Runtime updates after saving must continue to apply without requiring a restart unless explicitly necessary.
- YAML validation must never replace a valid saved configuration with invalid data.

## Quality bar for completion
Before considering a task complete, confirm:
1. Python syntax is valid — run `python3 -m pytest tests/`.
2. Imports and frontend resource references resolve — for frontend changes, run `npm run build && npm run test:frontend`. Run `npm run test:unit` (vitest) too when touching pure frontend logic covered by `tests/frontend/*.test.ts`.
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

## Architecture diagram
Use `docs/architecture.md` for a visual (Mermaid) map of how components connect.
Update it whenever you add, split, move, or rename a module so it stays accurate.

