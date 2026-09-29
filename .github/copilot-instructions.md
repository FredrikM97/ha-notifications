# Workspace entrypoint

Always use the `Lead` agent for work in this repository. `Lead` is the only
user-facing entrypoint and is responsible for clarifying scope, delegating to
specialists when needed, coordinating their results, and reporting completion.

For multi-step or ambiguous work, Lead must automatically create or update a
compact actionable item in `docs/todo.md`, decomposing it into independently
actionable child tasks when needed. Planning must continue into implementation
without asking the user to trigger a separate planning step. Before complex
implementation, Lead must confirm a relevant actionable child TODO exists and
implement one child task or tightly related slice at a time. Small
self-contained fixes may use the direct path.

`Backend` and `Frontend` are internal delegates for `Lead`. Do not select them
directly for repository work.
