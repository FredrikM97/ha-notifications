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
    Core[custom_components/ha_notifications/controller/core.py\nlifecycle host, frontend registration, and ordered workflows]
    Life[custom_components/ha_notifications/controller/lifecycle.py\nfeature setup/unload + scheduler]
    WS[custom_components/ha_notifications/bridge/websocket.py\nwebsocket transport]
    Trigger[custom_components/ha_notifications/features/conditions.py\nCondition evaluation and listeners]
    Coordinator[custom_components/ha_notifications/features/alert_coordinator.py\ngeneric per-alert coordinator]
    Flow[custom_components/ha_notifications/features/alert_flow.py\ndirect ordered alert workflow]
    Alerts[custom_components/ha_notifications/features/alerts.py\nAlert queries]
    Conditions[custom_components/ha_notifications/features/conditions.py\nConditionConfig + compiler]
    Confirm[custom_components/ha_notifications/features/confirmations.py\nConfirmationConfig + response sessions]
    Preview[custom_components/ha_notifications/features/notification_preview.py\nStateless preview trigger]
    Notify[custom_components/ha_notifications/features/notification.py\nNotificationConfig + delivery plan]
    Delivery[custom_components/ha_notifications/delivery/\nrecipient/channel resolution]
    Actions[custom_components/ha_notifications/features/follow_up_actions.py\nservice-call plans]
    History[custom_components/ha_notifications/features/history.py\nread-only history queries]
    Alert[custom_components/ha_notifications/features/configuration.py\nAlert + Configuration]
    ConfirmValue[custom_components/ha_notifications/domain/confirmation.py\nconfirmation contexts and response selections]
    RuntimeValue[custom_components/ha_notifications/domain/runtime.py\ntyped alert runtime state]
    WorkflowValue[custom_components/ha_notifications/domain/workflow.py\nnotification requests/outcomes and condition events]
    Storage[custom_components/ha_notifications/support/storage.py\nconfig and history persistence]
    Front[frontend/api.ts + Lit UI]

    Init --> Compose
    Compose --> Core
    Compose --> Life
    Front --> WS
    WS --> Life
    Core --> Life
    Core --> Alert
    Core --> Storage
    Core --> Flow
    Core --> Notify
    Core --> Actions
    Core --> History
    Flow --> ConfirmValue
    Alerts --> RuntimeValue
    Flow --> RuntimeValue
    Notify --> ConfirmValue
    Actions --> ConfirmValue
    Notify --> WorkflowValue
    Flow --> WorkflowValue
    Alert --> Trigger
    Alert --> Confirm
    Alert --> Notify
    Trigger --> Conditions
    Trigger --> Coordinator
    Coordinator --> Flow
    Notify --> Confirm
    Notify --> Delivery
    Confirm --> Actions
    Confirm --> Flow
    Testing --> Alerts
    Testing --> Confirm
    Testing --> Notify
    Flow --> Notify
    Flow --> Actions
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

- `__init__.py` constructs and attaches the feature lifecycle. `controller/core.py` hosts integration lifecycle and direct runtime state but never constructs, initializes, configures, or unloads individual features. `controller/lifecycle.py` owns generic feature setup/unload ordering, rollback, annotated feature/websocket-route dispatch, and the task scheduler.
- Features and the controller access Home Assistant directly for effects they own. There is no gateway or service locator; feature dependencies remain explicit through lifecycle composition.
- `controller/lifecycle.py` composes each feature with the shared `(hass, runtime, storage, storage)` context; runtime is process-local, while `Storage` owns configuration and independent history persistence.
- `bridge/websocket.py` generates Home Assistant handlers from feature websocket-route declarations and handles HA connection/result serialization. It remains a transport adapter, not a domain router. Frontend static path and panel registration belong to `controller/core.py`.
- `features/alerts.py` owns `AlertFeature`, its alert routes, direct runtime mappings, alert validation, active/inactive condition transitions, timestamps, condition-change clearing, and reload request.
- `features/alerts.py` owns typed alerts, the process-local runtime mapping, and delivery-state projections; `features/conditions.py` and `features/confirmations.py` own their condition and confirmation projections. `domain/runtime.py` owns the typed runtime aggregate, trace lifecycle, and explicit API serialization. Alert events publish an independent aggregate snapshot so configuration, mutable runtime facts, and event metadata travel together without conflating event IDs, workflow IDs, or notification IDs. History is a separate persistence/query boundary owned by `features/history.py` and stores those aggregates directly.
- `features/conditions.py` owns condition listeners, watcher registration, startup/reload/interval/template callbacks, evaluation, condition facts, and classification into explicit active, inactive, or error workflow events; it does not apply notification or delivery effects.
- `features/alert_coordinator.py` owns keyed runtime serialization: feature-supplied operations for one alert run in order, while different alert IDs can run concurrently. It is lifecycle-managed and knows no condition, confirmation, or workflow event types.
- `features/conditions.py` and `features/confirmations.py` pass typed facts through `AlertCoordinatorFeature`; they do not own notification, event logging, follow-up, or persistence decisions.
- `features/alert_flow.py` owns direct ordered condition-workflow sequencing, notification policy, confirmation preparation/expiry, delivery facts, follow-up ordering, and persistence. Alert runtime transitions remain in `AlertFeature`; resolved confirmation workflows remain in `ConfirmationFeature`.
- `features/confirmations.py` owns confirmation sessions, its Home Assistant action subscription, matching, reminder policy, max-attempt expiry, acknowledgement mutation, and resolution effects after a response is accepted.
- `features/notification_preview.py` validates preview payloads and manually triggers the normal condition workflow. It owns no alert lifecycle state; delivery and confirmation decisions remain in the normal workflow.
- `features/notification.py` owns message composition and notification send/clear effects, including confirmation completion delivery planning; `features/confirmations.py` owns alert-level confirmation configuration, pending sessions, reminder policy, and response workflows; `features/conditions.py` owns monitor and confirmation reminder listeners; `delivery/` resolves recipients and selects concrete mobile-app services versus generic Notify.
- `features/follow_up_actions.py` owns post-send and post-confirmation action planning and execution; `features/alerts.py` owns publication of their alert-event facts.
- `support/jinja.py` owns Home Assistant Jinja evaluation, recursive configuration-template rendering, template context, and null removal before service calls.
- `domain/service_calls.py` owns immutable service-call values and service-effects requests passed to follow-up execution.
- `features/history.py` owns history query transport, formatting, alert cleanup, and its independent persisted history list.
- `features/history.py` listens for `ha_notifications_alert_event` and forwards raw alert facts to independent history persistence. Workflows publish facts through Home Assistant's event bus and do not depend on history storage.
- `features/configuration.py` owns the flat `Alert` and `Configuration` models because they compose the persisted configuration document. `domain/workflow.py` owns typed workflow event/effect contracts used by ordered workflows. Each feature validates its own section at its workflow boundary, keeping feature ownership out of the configuration model.
- `domain/confirmation.py` owns immutable confirmation contexts and response selections passed between workflows; it does not own confirmation configuration, sessions, or persistence.
- `domain/workflow.py` owns immutable notification requests/outcomes and condition workflow events passed between application features; it does not own delivery, orchestration, or runtime state.
- `domain/runtime.py` owns the single process-local runtime aggregate. `AlertRuntimeState` stores the alert configuration, compact mutable state, and retained workflow dataclasses; owning features update their projections when they create facts, and the runtime exposes one structural transport mapping without parallel runtime wrappers or fact-specific serializers. Trace facts are removed only when the runtime is reset or deactivated.
- `features/conditions.py` owns `MonitorConfig`, watcher settings, and condition decisions.
- `features/notification.py` owns `NotificationConfig`, target normalization, confirmation resend policy, and delivery planning.
- `features/confirmations.py` owns `ConfirmationConfig` and confirmation sessions; `features/alert_coordinator.py` owns per-alert confirmation serialization; `features/alert_flow.py` owns confirmation effect ordering.
- `features/conditions.py` owns condition-editor validation and pure condition compilation. Duration values arrive as numeric seconds from the frontend; runtime timer conversion remains local to the owning feature.
- Feature models remain Pydantic objects at feature boundaries. Mapping output is
    created only at YAML/websocket edges with `model_dump()`.
- Confirmation runtime workflows receive typed configuration objects at their
    feature boundaries; session and effect payloads are separate runtime data.
- Conditions owns its watcher resources through `ConditionFeature`; pure condition
    decisions remain ordinary functions because they have no lifecycle resources.
- Follow-up action rendering validates each action as a feature-owned object;
    malformed actions remain isolated as typed `ActionResult` errors.
- `support/storage.py` stores configuration and history objects without interpreting feature behavior; runtime is discarded on restart, validated loading is used for runtime setup, and a separate raw read keeps the YAML recovery editor available for malformed saved documents.

## Dependencies and validation

Features receive the shared application context at construction and may depend only on explicitly declared lower-level feature relationships. There is no service locator, generic plugin framework, or application-wide router. Dependencies must remain acyclic.

Pydantic v2 models own feature configuration defaults, field limits, coercion, and feature-specific validation. `Alert` owns the typed alert graph, while explicit `model_dump()` calls produce structured websocket and persisted shapes. Voluptuous remains at the Home Assistant websocket envelope boundary. Whole-document configuration coordination handles only document shape and cross-feature invariants, delegating field semantics to the owning feature.

Invalid configuration is validated before config-entry options are updated, so invalid editor input cannot replace the last valid configuration. YAML is a frontend import/export format; the backend contract is structured JSON-like data. The canonical configuration shape keeps alert-level confirmation separate from notification content.

## Workflow contracts

- Trigger evaluation asks `AlertFeature` to perform the active or inactive
    runtime transition; the alert feature publishes the corresponding state
    fact, and `AlertFlow` sends
    the notification, publishes send success or failure, runs enabled follow-up
    actions sequentially, and persists state. Delivery failures are published
    and stop that delivery attempt; they do not run follow-up actions.
- Clearing a pending notification happens before removal or inactive-state
    completion. Clear failures are logged and do not prevent the owning alert or
    event-log cleanup from continuing.
- Confirmation validates the action session and runtime action ID before marking
    an alert confirmed. It publishes confirmation, clears the notification when
    configured, attempts an optional completion notification, publishes completion
    success or failure, runs confirmation follow-up actions, and persists state.
    Stale or unknown actions are ignored.
- Reload loads and validates configuration, unloads existing feature watchers,
    applies the new alert set, configures watchers, rebuilds persisted
    confirmation sessions, and then evaluates newly enabled or reload-eligible
    alerts. The reload lock serializes concurrent reloads.
- Unload removes external listeners, unloads feature watchers, cancels and
    awaits lifecycle-managed feature tasks, unregisters the frontend panel, flushes history
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
