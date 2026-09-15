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

## Work Routing
- Start from one concrete anchor: the named file, symbol, failing behavior, test, or command.
- Avoid expensive models whenever possible. Prefer splitting complex work into smaller, bounded tasks that cheaper models can complete; use an expensive model only when decomposition is impractical or cheaper models cannot reliably handle the remaining reasoning.
- Use `.github/logic-index.md` as the canonical router and `.github/notification-center-context.md` only for orientation; do not scan the repository broadly before selecting the owning path.
- Before the first edit, identify one falsifiable local hypothesis and one cheap check that could disconfirm it. Once the control path and check are clear, make the smallest testable edit.
- After the first substantive edit, run the narrowest relevant validation before reading broadly or opening another edit slice.
- Do not rerun full suites or repeat the same checks after every small edit. During a coherent feature or breaking migration, use only cheap syntax, import, or targeted blocker checks as needed; run focused and full regression validation when the planned slice is complete.
- If an intermediate breaking state produces expected failures, finish the planned migration before repairing them. Stop early only when a failure blocks the next edit or disproves the current hypothesis.
- Do not turn repeated `continue` prompts into an unbounded analysis loop. Keep one active objective, implement it, validate it, and only then choose the next objective.
- Read only active items in `todo.md` and `docs/todo.md`; do not spend context on completed history. Mark an active item complete when the requested behavior and focused validation are done.
- Treat broad rewrite requests as a sequence of bounded ownership changes. Do not begin a repository-wide rewrite or defer all validation unless the user explicitly requires that workflow.

## Required behavior for changes
- Verify imports and referenced files actually exist.
- Before architectural changes, verify the current filesystem and symbol locations; do not rely on stale paths or prior names in notes, summaries, or diagrams.
- Validate Python syntax after code changes.
- Make frontend changes only when the relevant resource exists and is loaded correctly.
- Favor small, targeted fixes over broad architectural changes.
- For an approved broad refactor, change one ownership boundary at a time, use cheap blocker checks during the boundary, then run focused tests when that boundary is coherent and update the architecture map before continuing.
- Keep `todo.md` and `docs/todo.md` for follow-up work; do not defer a defect that blocks the current behavior or validation path.
- Preserve alert behavior across create, edit, delete, enable/disable, save, reload, and runtime update flows.
- Put new logic in the module that already owns that concern (see
  `docs/architecture.md`); do not grow `controller/core.py` or `editor/index.ts`
  back into god-objects. `controller/core.py` is the composition root: it owns
  lifecycle, the gateway, public operations, and explicit application-service
  wiring, but no alert/notification/confirmation business decisions.
  Trigger/state-machine logic belongs in `features/triggering.py`;
  confirmation session tracking and confirmation-effect planning belongs
  in `features/confirmation.py`; notification composition belongs in
  `features/notification.py`; follow-up action rendering belongs in
  `features/follow_up_actions.py`; history formatting belongs in
  `support/history.py` and application workflows explicitly sequence recording
  and persistence;
  alert-editor section UI belongs in `frontend/sections.ts`.
- Prefer named, typed, awaited application methods for ordered internal
  workflows. Use event fan-out when multiple independent consumers genuinely
  benefit from decoupling, and keep event payloads and failure behavior explicit.
- Keep genuine Home Assistant inputs event-driven (template changes, timers,
  startup, and notification actions), but route each callback directly to its
  owning application workflow. Preserve ordering, failure policy, persistence,
  and controller-owned task cleanup explicitly.
- Keep the frontend authored with Lit. `frontend/panel.ts` is the LitElement
  shell, and child views should use Lit templates/rendering rather than ad-hoc
  DOM HTML construction.
- Keep `frontend/api.ts` as the only frontend/backend transport boundary. UI
  modules call typed API wrappers instead of constructing websocket messages or
  calling `hass.connection.sendMessagePromise` directly.
- Keep delivery layered: `features/notification.py` decides message
  content/recipients/route, `features/follow_up_actions.py` builds post-send and
  post-confirmation service-call plans, an application workflow sequences those
  plans, and `ha/gateway.py` remains the only Home Assistant effect boundary.
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
6. For changes touching these paths, exercise the focused regression cases: editor view transitions, duration serialization, mixed recipient validity, confirmation delivery, and post-send/post-confirmation actions.

## Output expectations
When making changes, summarize:
- what changed
- why the change was needed
- what validation was performed
- any remaining risk or follow-up recommendation

## Logic index
Use `.github/logic-index.md` as the first pointer for understanding the integration’s main flows.
Start there to find the relevant models, storage, runtime, frontend, and websocket files before reading deeper.

## Index Maintenance
- Keep `.github/logic-index.md` as the canonical codebase index: it owns flow routing, decision points, read order, and symptom-to-file mapping.
- Keep `.github/notification-center-context.md` as a short orientation map only; do not duplicate detailed ownership or lifecycle explanations there.
- When a module is moved, split, merged, renamed, or changes ownership, update `logic-index.md`, `notification-center-context.md`, and `docs/architecture.md` in the same change.
- Keep index entries compact and current: list real paths and owning symbols, link to architecture documentation for detail, and remove retired paths immediately.
- Before completing an index change, verify every referenced path exists and search for stale names from the old layout. Do not mark a structural change complete while the index points to retired modules.

## Architecture diagram
Use `docs/architecture.md` for a visual (Mermaid) map of how components connect.
Update it whenever you add, split, move, or rename a module so it stays accurate.

