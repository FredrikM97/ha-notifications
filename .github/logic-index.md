# HA Notifications logic index

This is the compact routing map for the direct-workflow architecture.

## Startup and lifecycle

- `backend/__init__.py`: Home Assistant config-entry and service lifecycle glue; constructs the feature lifecycle and attaches it to the controller host.
- `backend/controller/core.py`: lifecycle host, direct Home Assistant lifecycle effects, shared runtime state, configuration reload, ordered cross-feature workflows, and persistence. It does not construct features or own scheduled tasks.
- `backend/controller/lifecycle.py`: feature setup/unload ordering, dependency validation, rollback, annotated feature/websocket-route dispatch, and scheduler lifecycle.

## Frontend transport

- `backend/bridge/websocket.py`: Home Assistant handler generation from lifecycle websocket-route declarations and HA response serialization.
- `frontend/api.ts`: the only frontend/backend transport module.
- `frontend/panel.ts` and `frontend/editor/*`: Lit UI shell and editor workflows.

## Features

- `backend/features/alerts.py`: `AlertFeature` owns typed alerts, `AlertRuntime`, and the `alerts.apply`/`alerts.get`/`alerts.runtime`/`alerts.list`/`alerts.save` routes.
- `backend/features/conditions.py`: `ConditionFeature` owns condition listeners, per-alert evaluation serialization, and condition facts.
- `backend/features/alert_flow.py`: explicit ordering for condition and confirmation effects; it calls feature-owned operations directly and serializes alert effects.
- `backend/features/notification.py`: `NotificationFeature` owns notification composition and delivery outcome mutation; `backend/features/conditions.py` owns monitor and confirmation-resend listeners and due policy.
- `backend/features/conditions.py`: condition-editor Pydantic model, validation, and HA template compilation.
- `backend/features/confirmation.py`: `ConfirmationFeature` owns confirmation session state, Home Assistant action subscription lifecycle, action matching, and resolution into confirmation facts.
- `backend/features/testing.py`: `TestFeature` owns saved-alert and editor-draft test delivery, confirmation-session creation, TTL expiry, disposal, and its websocket routes.
- `backend/features/notification.py`: notification and repeat Pydantic models, target normalization, rendering/composition, direct send/clear planning, and `ConfirmationDeliveryPlanner` for clear/completion requests.
- `backend/delivery/`: recipient and notification-channel resolution; mobile-app entities use their concrete data-capable service and other targets use generic Notify.
- `backend/features/follow_up_actions.py`: post-send and post-confirmation service-call planning with per-action failure isolation.
- `backend/features/history.py`: direct history recording, event formatting, runtime last-event mutation, and persistence decisions.

## Domain and support

- `backend/features/configuration.py`: flat `Alert`, `Configuration`, and `AlertRuntime` models plus structured configuration routes; each feature validates its own section at its workflow boundary.
- `backend/domain/service_calls.py`: typed Home Assistant service-call values produced by workflows.
- `backend/domain/template_values.py`: recursive template rendering and null removal for service-call configuration.
- `backend/domain/durations.py`: backend duration normalization for YAML and runtime values.
- `backend/support/storage.py`: structured config-entry option persistence, validation coordination, and runtime-state shape repair.
- `backend/support/templates.py`: shared awaitable-aware Home Assistant template rendering adapter.
- `backend/support/scheduler.py`: `TaskScheduler` owns tracked feature background tasks and lifecycle cleanup.

## Main flows

### Save and reload

`bridge/websocket.py` -> lifecycle feature routes -> feature-owned configuration/storage workflows -> lifecycle reload -> condition watcher replacement and session reconstruction.

### Trigger and delivery

Home Assistant startup/template/timer callback -> `ConditionFeature` -> `AlertFlow` -> confirmation, notification, history, follow-up, and persistence operations.

### Confirmation

Home Assistant notification-action callback -> `ConfirmationFeature.resolve_action_event()` -> `AlertFlow` -> notification clear/completion plan -> Home Assistant service calls -> follow-up actions -> history and persistence.

### Frontend test payload

Websocket transport -> `TestFeature` draft session creation -> direct notification delivery -> optional confirmation session -> explicit discard or TTL cleanup without changing saved alert configuration.

## Ownership rules

- Required ordered steps use direct awaited calls, not internal events.
- Home Assistant's external event bus remains for genuine external callbacks.
- The composition module constructs features with the shared `(hass, state, config_storage, runtime_storage)` context; each feature selects only the values it needs. Core only hosts their lifecycle. Stateful features own their workflows, resources, and cleanup details. Stateless feature functions remain direct typed operations.
- Features may access the Home Assistant instance directly for effects they own; they must not import the whole controller or use a capability aggregate.
- Pydantic v2 owns feature/domain models; Voluptuous remains for HA websocket envelopes during migration.
- Invalid configuration is validated before writing and cannot replace valid saved configuration; YAML parsing and formatting belong to the frontend editor.

## Verification routing

- Condition behavior: `features/conditions.py`, `tests/backend/features/test_conditions.py`.
- Confirmation behavior: `features/confirmation.py`, `tests/backend/features/test_confirmation.py`.
- Delivery behavior: `features/notification.py`, notification-service modules, `tests/backend/features/test_notification.py`.
- History behavior: `features/history.py`, `tests/backend/features/test_history*.py`.
- Configuration behavior: `features/configuration.py`, `support/storage.py`, `tests/backend/domain/test_config_contract.py`, `tests/backend/support/test_storage.py`.
- Frontend behavior: `frontend/api.ts`, editor modules, `tests/frontend/`, and frontend build/test commands.
