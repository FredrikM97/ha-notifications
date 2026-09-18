# Architecture overview

HA Notifications uses a small controller composition root and direct feature workflows. Home Assistant's own event bus remains an external integration boundary for startup, notification actions, template changes, and timers. The private application EventBus has been removed.

The authored integration source lives under `custom_components/ha_notifications/`.
The frontend build adds the generated `dist/panel.js` bundle to that source tree
for local Home Assistant runs and HACS export.

## Layer map

```mermaid
flowchart LR
    HA[Home Assistant\nstate, services, external event bus]
    Store[HA Store and ConfigEntry options]
    Init[__init__.py\nHA lifecycle glue]
    Compose[__init__.py\nfeature construction]
    Core[custom_components/ha_notifications/controller/core.py\nlifecycle host and ordered workflows]
    Life[custom_components/ha_notifications/controller/lifecycle.py\nfeature setup/unload + scheduler]
    WS[custom_components/ha_notifications/bridge/websocket.py\nwebsocket transport]
    Trigger[custom_components/ha_notifications/features/conditions.py\nCondition evaluation and listeners]
    Flow[custom_components/ha_notifications/features/alert_flow.py\nordered alert effects]
    Alerts[custom_components/ha_notifications/features/alerts.py\nAlert queries]
    Conditions[custom_components/ha_notifications/features/conditions.py\nConditionConfig + compiler]
    Confirm[custom_components/ha_notifications/features/confirmation.py\nConfirmationConfig + sessions]
    Testing[custom_components/ha_notifications/features/testing.py\nSaved and draft alert tests]
    Notify[custom_components/ha_notifications/features/notification.py\nNotificationConfig + delivery plan]
    Delivery[custom_components/ha_notifications/delivery/\nrecipient/channel resolution]
    Actions[custom_components/ha_notifications/features/follow_up_actions.py\nservice-call plans]
    History[custom_components/ha_notifications/features/history.py\nhistory and persistence decisions]
    Alert[custom_components/ha_notifications/features/configuration.py\nAlert + Configuration + Runtime]
    Shared[custom_components/ha_notifications/domain/durations.py\nbackend duration normalization]
    Storage[custom_components/ha_notifications/support/storage.py\nConfigEntry options and runtime state shape]
    Front[frontend/api.ts + Lit UI]

    Init --> Compose
    Compose --> Core
    Compose --> Life
    Front --> WS
    WS --> Life
    Core --> Life
    Core --> Alert
    Core --> Storage
    Core --> Trigger
    Core --> Alerts
    Core --> Confirm
    Core --> Testing
    Core --> Flow
    Core --> Notify
    Core --> Actions
    Core --> History
    Alert --> Trigger
    Alert --> Confirm
    Alert --> Notify
    Trigger --> Conditions
    Trigger --> Flow
    Notify --> Confirm
    Notify --> Delivery
    Confirm --> Actions
    Confirm --> Flow
    Testing --> Alerts
    Testing --> Confirm
    Testing --> Notify
    Flow --> Notify
    Flow --> Actions
    History --> Storage
    Life --> Conditions
    Life --> Alerts
    Life --> Confirm
    Core --> HA
    Trigger --> HA
    Confirm --> HA
    Notify --> HA
    Actions --> HA
    HA -. callbacks .-> Trigger
    HA -. notification actions .-> Confirm
```

## Ownership rules

- `__init__.py` constructs and attaches the feature lifecycle. `controller/core.py` hosts integration lifecycle and shared runtime state but never constructs, initializes, configures, or unloads individual features. `controller/lifecycle.py` owns generic feature setup/unload ordering, rollback, annotated feature/websocket-route dispatch, and the task scheduler.
- Features and the controller access Home Assistant directly for effects they own. There is no gateway or service locator; feature dependencies remain explicit through lifecycle composition.
- `controller/lifecycle.py` composes each feature with the shared `(hass, state, config_storage, runtime_storage)` context; each feature selects only the values it needs and does not retain unused values.
- `bridge/websocket.py` generates Home Assistant handlers from feature websocket-route declarations and handles HA connection/result serialization. It remains a transport adapter, not a domain router.
- `features/alerts.py` owns `AlertFeature`, its alert routes, runtime-state projection, alert validation, timestamps, and reload request.
- `features/alerts.py` owns typed alerts and `AlertRuntime`; other features request alert runtime through its lifecycle route instead of constructing generic trigger state.
- `features/conditions.py` owns condition listeners, watcher registration, startup/reload/interval/template callbacks, per-alert task serialization, and condition facts. It does not allocate confirmations or apply delivery/history effects.
- `features/conditions.py` passes condition facts to `AlertFlow`; it does not own notification, confirmation, history, or persistence decisions.
- `features/alert_flow.py` owns only ordered application sequencing and per-alert effect serialization. Confirmation, notification, history, follow-up, and persistence operations remain owned by their feature modules.
- `features/confirmation.py` owns confirmation sessions, its Home Assistant action subscription, matching, and resolution into confirmation facts. `AlertFeature` owns acknowledgement mutation after a fact is resolved.
- `features/testing.py` owns saved-alert and draft test delivery, draft confirmation sessions, TTL expiry, disposal, and its websocket routes.
- `features/notification.py` owns message composition, notification send/clear planning, confirmation clear/completion delivery planning, and delivery attempt outcome state; `features/confirmation.py` owns the alert-level confirmation configuration and pending sessions; `features/conditions.py` owns monitor and confirmation-reminder listeners; `delivery/` resolves recipients and selects concrete mobile-app services versus generic Notify.
- `features/follow_up_actions.py` owns post-send and post-confirmation action planning.
- `domain/template_values.py` owns recursive configuration-template rendering and null removal before service calls.
- `features/history.py` owns history entry formatting, queries, deletion cleanup, recording, and runtime history mutation. Workflows call it directly; history does not depend on subscriber ordering.
- `features/configuration.py` owns the flat `Alert`, `Configuration`, and `AlertRuntime` models because they compose the persisted document and runtime boundary. Each feature validates its own section at its workflow boundary, keeping feature ownership out of the configuration model. `domain/` contains only shared value behavior.
- `features/conditions.py` owns `MonitorConfig`, watcher settings, and condition decisions.
- `features/notification.py` owns `NotificationConfig`, target normalization, confirmation resend policy, and delivery planning.
- `features/confirmation.py` owns `ConfirmationConfig` and confirmation sessions; `features/alert_flow.py` owns confirmation effect ordering.
- `features/conditions.py` owns condition-editor validation and pure condition compilation.
- `support/storage.py` owns structured config-entry option loading/saving, validation, and runtime-state persistence; application workflows call its explicit persistence port. The frontend owns YAML import/export.
- `support/templates.py` owns the small shared adapter for awaitable-aware Home Assistant template rendering; feature workflows still own when rendering occurs.
- `support/scheduler.py` owns background task tracking and lifecycle cleanup for feature-scheduled work.
- Feature models remain Pydantic objects at feature boundaries. Mapping output is
    created only at YAML/websocket edges with `model_dump()`.
- Confirmation runtime workflows receive typed configuration objects at their
    feature boundaries; session and effect payloads are separate runtime data.
- Conditions owns its watcher resources through `ConditionFeature`; pure condition
    decisions remain ordinary functions because they have no lifecycle resources.
- Follow-up action rendering validates each action as a feature-owned object;
    malformed actions remain isolated as typed `ActionResult` errors.
- `support/storage.py` owns structured configuration validation and runtime-state shape repair without interpreting feature behavior; YAML parsing/dumping belongs to the frontend.

## Dependencies and validation

Features receive the shared application context at construction and may depend only on explicitly declared lower-level feature relationships. There is no service locator, generic plugin framework, or application-wide router. Dependencies must remain acyclic.

Pydantic v2 models own feature configuration defaults, field limits, coercion, and feature-specific validation. `Alert` owns the typed alert graph, while explicit `model_dump()` calls produce structured websocket and persisted shapes. Voluptuous remains at the Home Assistant websocket envelope boundary. Whole-document configuration coordination handles only document shape and cross-feature invariants, delegating field semantics to the owning feature.

Invalid configuration is validated before config-entry options are updated, so invalid editor input cannot replace the last valid configuration. YAML is a frontend import/export format; the backend contract is structured JSON-like data. The canonical configuration shape keeps alert-level confirmation separate from notification content.

## Workflow contracts

- Trigger evaluation mutates runtime state first and passes the transition to
    `AlertFlow`. The flow records active or inactive history, then sends the
    notification, records send success or failure, runs enabled follow-up
    actions sequentially, and persists state. Delivery failures are recorded
    and stop that delivery attempt; they do not run follow-up actions.
- Clearing a pending notification happens before removal or inactive-state
    completion. Clear failures are logged and do not prevent the owning alert or
    history cleanup from continuing.
- Confirmation validates the action session and runtime action ID before marking
    an alert confirmed. It records confirmation, clears the notification when
    configured, attempts an optional completion notification, records completion
    success or failure, runs confirmation follow-up actions, and persists state.
    Stale or unknown actions are ignored.
- Reload loads and validates configuration, unloads existing feature watchers,
    applies the new alert set, configures watchers, rebuilds persisted
    confirmation sessions, and then evaluates newly enabled or reload-eligible
    alerts. The reload lock serializes concurrent reloads.
- Unload removes external listeners, unloads feature watchers, cancels and
    awaits lifecycle-managed feature tasks, unregisters the frontend panel, persists runtime
    state, and resets the setup guard. Setup failure uses the same unload path to
    roll back resources created before the failure.

## Lifecycle

1. The composition module constructs the controller host and feature lifecycle.
2. Core loads persisted state and coordinates configuration reload.
3. Features configure their watchers, runtime resources, and scheduled jobs.
4. Core registers external Home Assistant listeners and the frontend transport.
5. Startup/reload callbacks call direct awaited feature workflows.
6. Unload removes external listeners, unconfigures watchers, cancels and awaits lifecycle-managed jobs, unregisters frontend resources, and persists state.

Partial setup failures must unwind resources already created. Feature cleanup is idempotent.

## Adding a feature

Add a focused feature module or package containing its configuration model, validation, workflow, and tests. Declare a public async method with `@route("feature.operation")` when the frontend needs it; lifecycle discovery constructs it from its declared dependencies. Do not modify core to initialize a feature or add a global event vocabulary. Add a websocket command only when the feature needs a new public operation; preserve the existing transport boundary.

## Testing

Pure feature decisions use plain data tests. Controller tests use Home Assistant test doubles and verify ordering, persistence, watcher cleanup, reload, confirmation, delivery, and error handling. Backend changes require `python3 -m pytest tests/`; frontend changes additionally require the frontend build and test commands in `docs/todo.md`.
