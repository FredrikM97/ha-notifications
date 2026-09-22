# HA Notifications logic index

This is the compact routing map for the direct-workflow architecture.

## Startup and lifecycle

- `custom_components/ha_notifications/__init__.py`: Home Assistant config-entry and service lifecycle glue; constructs the feature lifecycle and attaches it to the controller host.
- `custom_components/ha_notifications/controller/core.py`: lifecycle host, frontend static path and panel registration, direct Home Assistant lifecycle effects, shared runtime state, configuration reload, ordered cross-feature workflows, and persistence. It does not construct features or own scheduled tasks.
- `custom_components/ha_notifications/controller/lifecycle.py`: feature setup/unload ordering, dependency validation, rollback, annotated feature/websocket-route dispatch, and scheduler lifecycle.

## Frontend transport

- `custom_components/ha_notifications/bridge/websocket.py`: Home Assistant handler generation from lifecycle websocket-route declarations and HA response serialization.
- `frontend/api.ts`: the only frontend/backend transport module.
- `frontend/panel.ts` and `frontend/editor/*`: Lit UI shell and editor workflows.

## Features

- `custom_components/ha_notifications/features/alerts.py`: `AlertFeature` owns typed alerts, runtime state coordination, and the `alerts.apply`/`alerts.get`/`alerts.runtime`/`alerts.list`/`alerts.save` routes.
- `custom_components/ha_notifications/features/conditions.py`: `ConditionFeature` owns condition listeners, per-alert evaluation serialization, and condition facts; it produces the shared `domain/workflow.py` condition-transition value.
- `custom_components/ha_notifications/features/alert_flow.py`: explicit ordering for condition and confirmation effects; it publishes alert facts and serializes alert effects.
- `custom_components/ha_notifications/features/notification.py`: `NotificationFeature` owns notification composition and delivery outcome mutation; `custom_components/ha_notifications/features/conditions.py` owns monitor and confirmation-resend listeners and due policy.
- `custom_components/ha_notifications/features/conditions.py`: condition-editor Pydantic model, validation, and HA template compilation.
- `custom_components/ha_notifications/features/confirmations.py`: `ConfirmationFeature` owns confirmation session state, Home Assistant action subscription lifecycle, action matching, reminders, and resolution into confirmation facts.
- `custom_components/ha_notifications/features/notification_preview.py`: `NotificationPreviewFeature` validates preview payloads and manually triggers the normal condition workflow; it owns no alert lifecycle state.
- `custom_components/ha_notifications/features/notification.py`: notification and repeat Pydantic models, target normalization, rendering/composition, direct send/clear planning, and `ConfirmationDeliveryPlanner` for clear/completion requests.
- `custom_components/ha_notifications/delivery/`: recipient and notification-channel resolution; mobile-app entities use their concrete data-capable service and other targets use generic Notify.
- `custom_components/ha_notifications/features/follow_up_actions.py`: post-send and post-confirmation service-call planning with per-action failure isolation.
- `custom_components/ha_notifications/features/history.py`: read-only history query transport and formatting helpers.
- `custom_components/ha_notifications/controller/core.py`: registers the alert-event listener during integration setup and stores raw event payloads.

## Domain and support

- `custom_components/ha_notifications/features/configuration.py`: flat `Alert` and `Configuration` models plus structured configuration routes; each feature validates its own section at its workflow boundary.
- `custom_components/ha_notifications/domain/service_calls.py`: typed Home Assistant service-call values and service-effects requests produced by workflows.
- `custom_components/ha_notifications/domain/confirmation.py`: immutable confirmation contexts and response selections passed between ordered workflows.
- `custom_components/ha_notifications/domain/runtime.py`: typed alert runtime state and its mapping persistence boundary.
- `custom_components/ha_notifications/domain/workflow.py`: notification requests/outcomes, condition transitions, typed condition/confirmation events, and ordered workflow effects passed to `AlertFlow`; runtime state remains a persistence-boundary mapping.
- `custom_components/ha_notifications/support/storage.py`: raw configuration-object and event-state-object persistence.
- `custom_components/ha_notifications/support/jinja.py`: shared Home Assistant Jinja evaluation, recursive configuration rendering, template context, and null removal.
- `custom_components/ha_notifications/support/scheduler.py`: `TaskScheduler` owns tracked feature background tasks and lifecycle cleanup.

## Main flows

### Save and reload

`bridge/websocket.py` -> lifecycle feature routes -> feature-owned configuration/storage workflows -> lifecycle reload -> condition watcher replacement and session reconstruction.

### Trigger and delivery

Home Assistant startup/template/timer callback -> `ConditionFeature` -> `AlertFlow` -> confirmation, notification, alert-event publication, follow-up, and persistence operations.

### Confirmation

Home Assistant notification-action callback -> `ConfirmationFeature.resolve_action_event()` -> `AlertFlow` -> notification clear/completion plan -> Home Assistant service calls -> follow-up actions -> alert-event publication and persistence.

### Frontend test payload

Websocket transport -> `NotificationPreviewFeature` validates and triggers `ConditionFeature` -> `AlertFlow` -> normal notification and optional confirmation workflow.

## Ownership rules

- Required ordered steps use direct awaited calls, not internal events.
- Home Assistant's external event bus remains for genuine external callbacks.
- The composition module constructs features with the shared `(hass, state, storage, storage)` context. `Storage` is one persistence owner for the raw configuration object and raw event state object; it does not validate, remap, or repair feature data.
- Features may access the Home Assistant instance directly for effects they own; they must not import the whole controller or use a capability aggregate.
- Pydantic v2 owns feature/domain models; Voluptuous remains for HA websocket envelopes during migration.
- Configuration validation happens in `ConfigurationFeature` before writing; YAML parsing and formatting belong to the frontend editor.

## Verification routing

- Condition behavior: `custom_components/ha_notifications/features/conditions.py`, `tests/backend/features/test_conditions.py`.
- Confirmation behavior: `custom_components/ha_notifications/features/confirmations.py`, `tests/backend/features/test_confirmations.py`.
- Delivery behavior: `custom_components/ha_notifications/features/notification.py`, notification-service modules, `tests/backend/features/test_notification.py`.
- History query behavior: `custom_components/ha_notifications/features/history.py`, `tests/backend/features/test_history*.py`.
- Alert-event persistence: `custom_components/ha_notifications/controller/core.py`, `custom_components/ha_notifications/support/storage.py`, `tests/backend/features/test_history_feature.py`.
- Configuration behavior: `custom_components/ha_notifications/features/configuration.py`, `custom_components/ha_notifications/support/storage.py`, `tests/backend/domain/test_config_contract.py`, `tests/backend/support/test_storage.py`.
- Frontend behavior: `frontend/api.ts`, editor modules, `tests/frontend/`, and frontend build/test commands.
