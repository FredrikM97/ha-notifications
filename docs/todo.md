# Active Follow-Up Work

- [x] Remove obsolete `features/triggering.py` and verify lifecycle discovery
	imports only active feature modules.
- [x] Replace `NotificationSchedule` indirection with direct listener-owned
	timing while preserving monitor checks and confirmation reminders.
- [x] Add regression tests proving generic Notify preserves confirmation clear
	behavior, completion delivery, and retries.
- [x] Audit feature constructors and workflow methods for unused arguments,
	  trivial forwarding methods, and stale compatibility paths. The shared
	  lifecycle constructor contract is intentional; unused context parameters
	  are consistently underscore-prefixed, and no stale compatibility paths
	  were found.
- [x] Review `support/storage.py` and shared helpers for safe inlining or
	  removal after the architecture cleanup. Storage wrappers remain the
	  explicit persistence port; shared normalization and shape repair are
	 ownership-specific and are not redundant.
- [x] Add focused `AlertFlow` tests covering condition delivery ordering,
	  delivery failure handling, confirmation completion, and persistence.
- [x] Add frontend component regression coverage for confirmation toggles,
	  test-alert delivery, YAML condition errors, and popup dismissal.
- [x] Run frontend build and frontend tests when frontend modules change.
- [x] Refactor `AlertEditorController` navigation, section visibility, status indicators, and validation controls to derive from Lit templates instead of DOM queries and mutations.
- [x] Move editor dashboard visibility and action restoration into a Lit-owned panel/editor state boundary.
- [x] Replace editor modal and toast mounting with Lit-owned state and conditional templates; retain direct DOM access only for Home Assistant code-editor integration.
- [x] Remove remaining editor `querySelector` usage for form controls by passing typed element references or extracting values through component-owned state.
- [x] `frontend/condition-builder.ts`: move condition rows and interaction state into a stateful Lit element; retain only typed event targets.
- [x] `frontend/recipient-picker.ts`: move recipient filtering, selection, and result rendering into a stateful Lit element and Lit-owned mounting.
- [x] `frontend/editor/index.ts`: finish dashboard actions and modal state as declarative Lit templates; retain only explicit dashboard/editor ownership and HA editor integration boundaries.
- [x] `frontend/editor/helpers.ts`: replace toast/modal host creation and selector lookups with Lit-owned state; keep CodeMirror sizing and Home Assistant editor readiness imperative.
- [x] `frontend/panel.ts`: replace external history/YAML mount queries with child Lit components or explicit element references; remove render-time DOM existence checks.
- [x] `frontend/history.ts`: replace the external `render(content, container)` boundary with a Lit history component while preserving filter callbacks and details interactions.
- [x] `frontend/yaml-view.ts`: replace editor lookup/mounting with a Lit YAML component; retain only the Home Assistant code-editor readiness/value bridge.
- [x] Frontend DOM audit: remaining production DOM access is limited to HA code-editor discovery/value extraction in `fillActionEditors`, CodeMirror's internal `.cm-scroller` sizing, the explicit editor host create/remove lifecycle, and the duplicate-editor host guard. No dashboard, modal/toast, form-control, or history-details ownership remains selector-driven.
- [x] Support multiple confirmation response buttons, preserve the selected action, and expose it to completion messages and follow-up action templates while retaining the legacy single-button configuration.
- [x] Add `ConfirmationContext` projections for template values and history details so passive consumers do not interpret confirmation fields.
- [x] Move prepared notification actions and confirmation follow-up selection behind `ConfirmationFeature` so delivery and orchestration consume narrow outputs.
- [x] Consolidate repeated runtime and template-context plumbing behind owned adapters, removing duplicate scalar and mapping fields from workflow call sites.
- [x] Replace the remaining `confirmation_for_alert()` helper with a model-owned confirmation configuration boundary.
