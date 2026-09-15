# Notification Center logic index

This is the compact routing map for the direct-workflow architecture.

## Startup and lifecycle

- `custom_components/notification_center/__init__.py`: Home Assistant config-entry and service lifecycle glue.
- `custom_components/notification_center/__init__.py`: constructs the feature lifecycle and attaches it to the controller host.
- `custom_components/notification_center/controller/core.py`: lifecycle host, gateway construction, shared runtime state, configuration reload, ordered cross-feature workflows, and persistence. It does not construct features or own scheduled tasks.
- `custom_components/notification_center/controller/lifecycle.py`: feature setup/unload ordering, dependency validation, rollback, annotated feature/websocket-route dispatch, and scheduler lifecycle.
- `custom_components/notification_center/ha/gateway.py`: the only Home Assistant API boundary, including service calls, template/timer watchers, external event listeners, persistence, panel, and websocket registration.

## Frontend transport

- `custom_components/notification_center/bridge/websocket.py`: Home Assistant handler generation from lifecycle websocket-route declarations, legacy command registration during migration, and HA response serialization.
- `custom_components/notification_center/frontend/api.ts`: the only frontend/backend transport module.
- `custom_components/notification_center/frontend/panel.ts` and `frontend/editor/*`: Lit UI shell and editor workflows.

## Features

- `features/alerts.py`: `AlertFeature` owns typed alerts, `AlertRuntime`, and the `alerts.apply`/`alerts.get`/`alerts.runtime`/`alerts.list`/`alerts.save` routes.
- `features/triggering.py`: `TriggeringFeature` owns condition listeners and transition decisions only; it obtains runtime records from `AlertFeature`, confirmation action preparation from `ConfirmationFeature`, and scheduling policy from notification.
- `features/trigger_effects.py`: applies trigger transitions through notification delivery, confirmation tracking, history, follow-up actions, and runtime persistence.
- `features/notification.py`: `NotificationSchedule` owns repeat and confirmation-resend interval/due policy.
- `features/conditions.py`: condition-editor Pydantic model, legacy condition mapping compatibility, and HA template compilation.
- `features/confirmation.py`: `ConfirmationFeature` owns confirmation session state, Home Assistant action subscription lifecycle, action matching, and resolution into confirmation facts.
- `features/testing.py`: `TestFeature` owns saved-alert and editor-draft test delivery, confirmation-session creation, TTL expiry, disposal, and its websocket routes.
- `features/confirmation_flow.py`: `ConfirmationFlow` orders delivery, history, and follow-up processing after a confirmation fact without owning sessions or notification composition.
- `features/notification.py`: notification and repeat Pydantic models, target normalization, rendering/composition, direct send/clear planning, and `ConfirmationDeliveryPlanner` for clear/completion requests.
- `delivery/`: recipient/channel resolution, generic notify routing, and legacy Mobile App service resolution.
- `features/follow_up_actions.py`: post-send and post-confirmation service-call planning with per-action failure isolation.
- `features/history.py`: direct history recording, event formatting, runtime last-event mutation, and persistence decisions.

## Domain and support

- `features/configuration.py`: dynamically assembled flat `AlertFeatures`, `Alert`, `Configuration`, and `AlertRuntime` models plus YAML routes. Feature modules register their own alert fields through `features/configuration_registry.py`, so the persisted YAML shape stays unchanged without a central feature-config import list.
- `domain/service_calls.py`: typed Home Assistant service-call values produced by workflows.
- `domain/template_values.py`: recursive template rendering and null removal for service-call configuration.
- `domain/durations.py`: duration parsing and formatting.
- `domain/service_calls.py`: typed Home Assistant service-call values produced by workflows.
- `support/storage.py`: YAML serialization, validation coordination, and runtime-state shape repair.
- `support/scheduler.py`: `TaskScheduler` owns tracked feature background tasks and lifecycle cleanup.

## Main flows

### Save and reload

`bridge/websocket.py` -> lifecycle feature routes -> feature-owned configuration/storage workflows -> lifecycle reload -> triggering watcher replacement and session reconstruction.

### Trigger and delivery

Home Assistant startup/template/timer callback -> `TriggeringWorkflow` -> pure transition decision -> core ordered workflow -> notification composition -> gateway service calls -> history and follow-up actions -> persisted runtime state.

### Confirmation

Home Assistant notification-action callback -> `ConfirmationFeature.resolve_action_event()` -> `ConfirmationFlow` -> notification clear/completion plan -> gateway calls -> follow-up actions -> history and persistence.

### Frontend test payload

Websocket transport -> `DraftFeature` draft session creation -> direct notification delivery -> optional confirmation session -> explicit discard or TTL cleanup without changing saved alert configuration.

## Ownership rules

- Required ordered steps use direct awaited calls, not internal events.
- Home Assistant's external event bus remains for genuine external callbacks.
- The composition module constructs features; core only hosts their lifecycle. Stateful features own their workflows, resources, and cleanup details. Stateless feature functions remain direct typed operations.
- Features receive narrow typed capabilities and must not import Home Assistant or the whole controller.
- Pydantic v2 owns feature/domain models; Voluptuous remains for HA websocket envelopes during migration.
- Invalid YAML is validated before writing and cannot replace valid saved configuration.

## Verification routing

- Trigger behavior: `features/triggering.py`, `tests/test_triggering.py`, `tests/test_controller_core.py`.
- Confirmation behavior: `features/confirmation.py`, `tests/test_confirmation.py`, controller confirmation tests.
- Delivery behavior: `features/notification.py`, notification-service modules, `tests/test_notification.py`.
- History behavior: `features/history.py`, `tests/test_history*.py`.
- Configuration behavior: `features/configuration.py`, `support/storage.py`, `tests/test_config_contract.py`, `tests/test_storage.py`.
- Frontend behavior: `frontend/api.ts`, editor modules, `tests/frontend/`, and frontend build/test commands.
