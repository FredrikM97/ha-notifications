# HA Notifications Copilot Instructions

## Project purpose
This repository is a Home Assistant custom integration named HA Notifications. The project should feel like a native Home Assistant feature: simple by default, powerful when needed, and reliable enough to trust.

## Core principles
- Keep the UI compact and native to Home Assistant.
- Preserve working functionality while improving clarity.
- Prefer native HA selectors and patterns over custom controls.
- Treat YAML as a first-class configuration option.
- Keep confirmation as a top-level alert concern, separate from the notification message/recipient block. Do not add or retain nested `notification.confirmation` compatibility paths.
- Validate before claiming a fix is complete.
- Never silently discard valid config or unsaved edits.

## Work Routing
- Start from one concrete anchor: the named file, symbol, failing behavior, test, or command.
- Avoid expensive models whenever possible. Prefer splitting complex work into smaller, bounded tasks that cheaper models can complete; use an expensive model only when decomposition is impractical or cheaper models cannot reliably handle the remaining reasoning.
- Use `.github/logic-index.md` as the canonical router and `.github/ha-notifications-context.md` only for orientation; do not scan the repository broadly before selecting the owning path.
- Before the first edit, identify one falsifiable local hypothesis and one cheap check that could disconfirm it. Once the control path and check are clear, make the smallest testable edit.
- After the first substantive edit, run the narrowest relevant validation before reading broadly or opening another edit slice.
- Do not rerun full suites or repeat the same checks after every small edit. During a coherent feature or breaking migration, use only cheap syntax, import, or targeted blocker checks as needed; run focused and full regression validation when the planned slice is complete.
- During an active TODO migration, defer broad test suites until the current TODO item is coherent and ready to close. Use only focused syntax/import/blocker checks while an item is intentionally intermediate; run the full suite after the item is complete, not after every edit.
- If an intermediate breaking state produces expected failures, finish the planned migration before repairing them. Stop early only when a failure blocks the next edit or disproves the current hypothesis.
- Do not turn repeated `continue` prompts into an unbounded analysis loop. Keep one active objective, implement it, validate it, and only then choose the next objective.
- When the user says `continue`, `keep iterating`, or asks to work through all TODO items, treat that as standing authorization to advance through the active unchecked items in document order during the same turn. After each item reaches its focused validation checkpoint, immediately select the next relevant unchecked item and continue without pausing for status confirmation. Stop only when the requested sequence is complete, a validation failure remains unresolved, or a genuine blocker requires user input.
- For `continue with todo`, do not end the turn, call the completion signal, or ask for confirmation after a single TODO item. Keep advancing through every eligible unchecked item in document order during the same turn; skip only explicitly approval-gated items or items blocked by an unresolved validation failure, and record the reason in `docs/todo.md` before continuing.
- Read only active items in `todo.md` and `docs/todo.md`; do not spend context on completed history. Mark an active item complete when the requested behavior and focused validation are done.
- Treat broad rewrite requests as a sequence of bounded ownership changes. Do not begin a repository-wide rewrite or defer all validation unless the user explicitly requires that workflow.

## TODO and Analyze Commands
- Treat a user request containing `todo` as a request to inspect the active
  items in `docs/todo.md`, add the requested concern as an actionable unchecked
  item when it is missing, and then work the first relevant unchecked item in
  document order.
- Treat a user request containing `analyze` as a request to inspect the named
  code path for bugs, ownership problems, missing tests, and contract risks;
  record actionable findings in `docs/todo.md` before implementation, then
  continue with the first relevant unchecked item when the user asks to act.
- When a task discovers follow-up work, add it to `docs/todo.md` in the owning
  section before moving on. Keep completed history out of the active list.
- Do not skip earlier unchecked TODO items merely because a later item is more
  interesting. If an earlier item is blocked or intentionally out of scope,
  record the reason beside it and proceed to the next item.
- After completing an item, run its narrow validation, mark it complete, and
  only then select the next unchecked item.

## Required behavior for changes
- Verify imports and referenced files actually exist.
- Keep imports at module scope. Do not add lazy imports inside functions or
  methods; only retain them when required to break a documented import cycle,
  support an optional dependency, or preserve lifecycle discovery behavior.
- Do not add test-only spies, ordering trackers, fake state, or compatibility
  scaffolding to production source. Test-only behavior belongs in test doubles,
  fixtures, and helpers under `tests/`; production code should contain only
  behavior required by the application.
- Before architectural changes, verify the current filesystem and symbol locations; do not rely on stale paths or prior names in notes, summaries, or diagrams.
- Validate Python syntax after code changes.
- Every new frontend or backend feature must include focused automated tests in the same change. Bug fixes must add or update a regression test for the reported behavior whenever the owning code can be tested.
- Test user-visible frontend behavior at the component or helper boundary, and test backend behavior at the owning feature or application boundary. Do not rely on build, smoke, or type checks as substitutes for behavioral tests.
- For frontend tests, prefer Vitest snapshots for complete rendered, serialized, or structured contracts, and reuse JSON fixtures whenever possible. Put reusable frontend test setup, builders, and mock clients in `tests/frontend/conftest.ts` rather than duplicating scaffolding in each test file, following the backend `tests/backend/conftest.py` pattern. Keep ordinary assertions for small invariants, side effects, and error behavior; update snapshots only when the intended UI or payload contract changes.
- For frontend DOM interactions, use Testing Library queries scoped through the shared `editorQueries()` helper and `user-event` for user actions. Keep direct selectors for implementation-specific Lit fragments or custom Home Assistant element properties where semantic queries do not apply.
- Make frontend changes only when the relevant resource exists and is loaded correctly.
- Favor small, targeted fixes over broad architectural changes.
- For an approved broad refactor, change one ownership boundary at a time, use cheap blocker checks during the boundary, then run focused tests when that boundary is coherent and update the architecture map before continuing.
- Keep `todo.md` and `docs/todo.md` for follow-up work; do not defer a defect that blocks the current behavior or validation path.
- Preserve alert behavior across create, edit, delete, enable/disable, save, reload, and runtime update flows.
- Put new logic in the module that already owns that concern (see
  `docs/architecture.md`); do not grow `controller/core.py` or `editor/index.ts`
  back into god-objects. `controller/core.py` is the lifecycle host: it owns
  integration startup/shutdown only, but must never construct, initialize,
  configure, unload, or route individual features. A dedicated lifecycle or
  composition class owns feature discovery and initialization. Storage owns
  config load/save; a lifecycle-managed scheduler owns feature tasks; saved and
  draft test delivery, TTL expiry, disposal, and routes belong to the test feature.
  Core has no alert/notification/confirmation business decisions.
  Trigger/state-machine logic belongs in `features/conditions.py`;
  confirmation session tracking and confirmation-effect planning belongs
  in `features/response_actions.py`; notification composition belongs in
  `features/notification.py`; follow-up action rendering belongs in
  `features/follow_up_actions.py`; history formatting belongs in
  `features/history.py` and application workflows explicitly sequence recording
  and persistence;
  alert-editor section UI belongs in `frontend/sections/*.ts`.
- Prefer named, typed, awaited application methods for ordered internal
  workflows. Use event fan-out when multiple independent consumers genuinely
  benefit from decoupling, and keep event payloads and failure behavior explicit.
- Treat feature routes as frontend transport only. Backend feature workflows call
  their declared class dependencies directly, never through string route dispatch.
- When the user explicitly approves a structural migration, it is acceptable to
  break the old internal or persisted contract. Prefer one canonical model and
  migrate all producers, consumers, fixtures, and tests together; do not keep
  parallel legacy branches merely to avoid a coordinated change.
- Do not use `FeatureServices`, service locators, or callback bags. Construct
  each feature with explicit dependencies and the state-machine object it owns.
- Feature classes may use Home Assistant directly for their owned framework
  effects. Do not retain a gateway wrapper solely to conceal HA access.
- Keep genuine Home Assistant inputs event-driven (template changes, timers,
  startup, and notification actions), but route each callback directly to its
  owning application workflow. Preserve ordering, failure policy, persistence,
  and controller-owned task cleanup explicitly.
- Keep the frontend authored with Lit. `frontend/panel.ts` is the LitElement
  shell, and child views should use Lit templates/rendering rather than ad-hoc
  DOM HTML construction.
- Prefer Home Assistant native controls for ordinary editor fields: use
  `ha-input` for single-line, numeric, and duration values, `ha-switch` for
  binary settings, and native HA selectors where an existing selector fits.
  Do not use obsolete `ha-textfield` markup. Keep native HTML controls only
  when Home Assistant has no suitable component, such as multiline text,
  section navigation, or custom autocomplete/condition-builder interactions.
- Keep `frontend/api.ts` as the only frontend/backend transport boundary. UI
  modules call typed API wrappers instead of constructing websocket messages or
  calling `hass.connection.sendMessagePromise` directly.
- Keep delivery layered: `features/notification.py` decides message
  content/recipients/route, `features/follow_up_actions.py` builds post-send and
  post-confirmation service-call plans, an application workflow sequences those
  plans, and each owning feature performs its Home Assistant effects directly.
- Prefer straightforward `if` blocks over ternary/conditional-expression
  style for anything with real branching logic. A simple, non-nested
  two-branch expression (e.g. `"Enabled" if enabled else "Disabled"`) may use
  a ternary; never chain/nest ternaries - use an `if` block instead once a
  third branch or nested condition appears.
- In backend tests, prefer syrupy snapshots over long assertion lists whenever
  the complete structured value, rendered payload, transition, history entry,
  or configuration contract is the behavior under test. Keep ordinary
  assertions for small behavioral invariants, side effects, exception
  types/messages, and values where only one property matters; do not force
  snapshots onto those focused checks.
- Reuse the shared builders and YAML fixtures in `tests/backend/conftest.py`
  (`alert_fixture`, `make_alert`, `make_confirmation_alert`, and
  `make_notification_alert`) as the starting point for test data. Apply only
  the minimum test-specific overrides rather than recreating base alert,
  notification, monitor, condition, or confirmation dictionaries inside
  individual tests.
- When the same test object or payload shape appears in more than one test
  module, add or extend a named fixture/builder in `tests/backend/conftest.py` and load
  stable structured data from `tests/backend/fixtures/alerts.yaml`; do not duplicate
  large literals across tests. Keep deliberately minimal malformed or boundary
  inputs local when their incompleteness is the behavior being tested.
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
- Keep `.github/ha-notifications-context.md` as a short orientation map only; do not duplicate detailed ownership or lifecycle explanations there.
- When a module is moved, split, merged, renamed, or changes ownership, update `logic-index.md`, `ha-notifications-context.md`, and `docs/architecture.md` in the same change.
- Keep index entries compact and current: list real paths and owning symbols, link to architecture documentation for detail, and remove retired paths immediately.
- Before completing an index change, verify every referenced path exists and search for stale names from the old layout. Do not mark a structural change complete while the index points to retired modules.

## Architecture diagram
Use `docs/architecture.md` for a visual (Mermaid) map of how components connect.
Update it whenever you add, split, move, or rename a module so it stays accurate.

