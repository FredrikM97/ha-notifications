# Notification Center logic index

This is a compact map of the integration's main execution flows and decision points.

## 1. Startup and integration lifecycle
- `custom_components/notification_center/__init__.py`
  - minimal HA lifecycle glue: constructs `controller/core.py`'s
    `NotificationCenterController` via `build_controller(hass)`, calls
    `controller.async_setup()`/`async_unload()`
  - the two entry-level HA services (`reload`, `test`)

## 2. The controller kernel + feature plugins
- `custom_components/notification_center/controller/core.py`
  - `NotificationCenterController`: the kernel. Owns the single
    `HomeAssistantGateway`, the `EventBus` wiring/query responders, all setup/reload sequencing,
    and every public frontend-facing operation (`list_alerts`,
    `save_alert`, `delete_alert`, `test_alert`, `test_alert_payload`,
    `discard_test_payload`, `get_history`, `get_yaml`, `validate_yaml`,
    `save_yaml`, `validate_conditions`, `reload`)
  - "when does an alert fire, and what happens next" is *not* sequenced or
    decided here anymore - `core.py` publishes lifecycle/configuration facts;
    decisions and command production live in `features/*.py`
- `custom_components/notification_center/controller/commands.py`
  - the closed `Command` vocabulary (`CallService`, `TrackTemplate`,
    `TrackInterval`, `Unsubscribe`, `PersistSave`, `Emit`, `RunBatch`) -
    the only effects `EventBus.execute()` dispatches
- `custom_components/notification_center/controller/events.py`
  - the shared `Event` dataclass plus every fact-event and query-name
    string constant features/core use to publish/subscribe/ask
- `custom_components/notification_center/controller/bus.py`
  - `EventBus`: `publish(event)` (fire-and-forget facts, 0..N handlers),
    `execute(command)` (bus orchestration or typed leaf-listener dispatch),
    and `ask(query_name, payload)`
    (request/response reads, exactly one responder per query name - either
    `core.py` for alert/runtime-state/session reads, or `ha/gateway.py` for
    template/service/registry/condition passthroughs)
- `custom_components/notification_center/features/triggering.py`
  - pure decisions unchanged: `register_specs` (what to watch),
    `on_condition_result` (the active/acknowledged/repeat state machine,
    returns a `TriggerTransition`), `record_send_result`, `mark_confirmed`.
    A thin `register(bus)` + `handle_*` layer translates
    `alert.configured` into watcher commands, and `condition.evaluated`
    into `condition.active`/`inactive`/`error` and
    `notification.send_requested` facts, and reacts to
    `notification.sent`/`failed`/`alert.confirmed_fact` for bookkeeping
- `custom_components/notification_center/features/confirmation.py`
  - pure decisions unchanged: one session table (`track`/`clear`)
    covering both real alerts and unsaved editor test payloads,
    `match_action_event`, `plan_confirmation_effects` (the
    post-confirmation completion message/clear/follow-up decision). A
    thin adapter layer reacts to session start/discard, `action.received`,
    and `alert.confirmed_effects`, asking the bus for sessions/runtime state
    instead of core mutating confirmation state
- `custom_components/notification_center/features/follow_up_actions.py`
  - pure: `build_service_calls` renders an alert's configured follow-up
    actions into service-call commands, isolating one bad action's error
    from the others (`ActionResult(index, command, error)`). Reacts to
    `notification.sent` (post-send) and `actions.run_requested`
    (post-confirmation), emitting one `RunBatch` per action
- `custom_components/notification_center/features/notification.py`
  - pure composer unchanged: `compose_send`/`compose_clear` - renders
    notification content, validates confirmation delivery, and produces
    `CallService` commands. Reacts to `notification.send_requested`/
    `notification.clear_requested`, asking the bus for `render`/
    `has_service`/the registry snapshot
- `custom_components/notification_center/features/notification_services/`
  - pure service-selection components: `targets.py` owns shared target
    expansion and notify-entity matching; `targeted.py` owns generic target
    notification planning; `mobile_app.py` owns Mobile App
    entry-name to notify-service resolution and verification. Direct Mobile
    App lookup does not leak into generic planning.
- `custom_components/notification_center/features/history.py`
  - a bus **listener**, not a kernel primitive - subscribes to the same
    fact events other features emit and turns them into entries via
    `support/history.py`, persisted with the ordinary `PersistSave`
    command. `core.py` has no history-writing logic.
- `custom_components/notification_center/features/rendering.py`
  - pure `render_value`/`remove_none` shared by `notification.py` and
    `follow_up_actions.py`, taking an injected `render` callable

## 3. Home Assistant boundary
- `custom_components/notification_center/ha/gateway.py`
  - `HomeAssistantGateway`: the *only* module that imports
    `homeassistant.*`. Every service call, state/registry read, event bus
    listener, template render, Store/file persistence, and frontend/panel/
    websocket registration goes through here, called only from
    `controller/core.py`. It also registers itself as the bus's responder
    for `RENDER_TEMPLATE`/`HAS_SERVICE`/`FETCH_REGISTRY_SNAPSHOT`/
    `EVALUATE_CONDITION`/`GET_STATES` via `register_bus_responders(bus)`. It also listens
    for HA-facing leaf commands and owns template/interval subscriptions,
    so neither reads nor reactive effects pass through `core.py`

## 4. Shared domain layer
- `custom_components/notification_center/domain/alert_schema.py`
  - alert schema, `ConfigNormalizer`/`normalize_config`/`normalize_alert`
    - used by both `bridge/validation.py` and `support/storage.py`
- `custom_components/notification_center/domain/condition_schema.py`
  - `compile_condition`: visual condition rows -> Jinja template string -
    used by `features/triggering.py` and `bridge/validation.py`
- `custom_components/notification_center/domain/durations.py`
  - duration parse/format helpers

## 5. Persistence and frontend loading
- `custom_components/notification_center/support/storage.py`
  - pure: YAML (de)serialization (`parse_yaml_text`,
    `normalize_and_validate_yaml`, `normalize_and_dump_yaml`) and
    runtime-state shape repair (`ensure_runtime_state_shape`) - no Home
    Assistant import
- `custom_components/notification_center/support/history.py`
  - pure: `format_entry`/`append_entry`/`list_entries`/`remove_alert` over
    a history list `core.py` owns and persists

## 6. Frontend-facing interface
- `custom_components/notification_center/bridge/websocket.py`
  - registers the 12 `notification_center/*` websocket commands; each
    handler: parse `msg` -> validate (if it carries an alert/YAML payload)
    -> call the matching `controller/core.py` method -> return the result
- `custom_components/notification_center/bridge/validation.py`
  - normalize/validate incoming alert/YAML payloads (wraps
    `domain/alert_schema.py` and `domain/condition_schema.py`)
- `custom_components/notification_center/bridge/panel.py`
  - pure: `registration_plan` builds the frontend registration data;
    `controller/core.py` performs the actual registration via the gateway.
    This is the explicit "loading the frontend" exception: no application
    data, no backend dependency

## 7. Frontend/editor flow
- `custom_components/notification_center/frontend/api.ts`
  - the only frontend/backend transport module; all websocket message
    wrappers live here
- `custom_components/notification_center/frontend/editor/index.ts`
  - `AlertEditorController`: dialog state, wiring, save/test/validate flows
- `custom_components/notification_center/frontend/sections.ts`
  - barrel re-exporting one render function per alert-editor section from
    `frontend/sections/*.ts` (one file per section - new section = one new
    file + one export)
- `custom_components/notification_center/frontend/editor/helpers.ts`
  - shared render helpers (`field`, `section`, `codeEditor`, `durationInput`,
    YAML (de)serialization)
- `custom_components/notification_center/frontend/editor/types.ts`
  - `EditorContext`, section metadata, and other shared editor types/constants
- `custom_components/notification_center/frontend/yaml-view.ts`
  - global YAML load, validation, save, and reload behavior
- `custom_components/notification_center/frontend/types.ts`
  - shared frontend alert, registry, and Home Assistant contracts
- `custom_components/notification_center/frontend/panel.ts`
  - LitElement dashboard/card shell, list actions, and tab selection
- `custom_components/notification_center/frontend/styles.ts`
  - compact style and layout rules

## 8. Core decision points to understand
When debugging a problem, these are the main places to check:

- Data model: `domain/alert_schema.py`
- Stored config safety: `support/storage.py`, `bridge/validation.py`
- Validation entry points: `config_flow.py`, `bridge/validation.py`
- Trigger and condition execution: `features/triggering.py`,
  `controller/core.py` (publishes `condition.evaluated`), `controller/bus.py`
- Frontend save and reload behavior: `frontend/api.ts`,
  `frontend/editor/index.ts`, `bridge/websocket.py`

## 9. Recommended read order
For most bugs, read in this order:
1. `domain/alert_schema.py`
2. `support/storage.py`
3. `config_flow.py`
4. `__init__.py`
5. `controller/core.py` then `controller/bus.py` then `features/triggering.py`
6. `bridge/websocket.py`
7. the relevant frontend file (`frontend/editor/index.ts`,
   `frontend/sections.ts`, or `frontend/panel.ts`)

## 10. Quick symptom mapping
- Save fails or config disappears: `config_flow.py`, `support/storage.py`,
  `bridge/websocket.py`, `controller/core.py` (`save_alert`)
- Alert does not trigger: `features/triggering.py`, `controller/core.py`
  (`_request_condition_check`), `ha/gateway.py` (watch listeners),
  `domain/condition_schema.py`
- Periodic or change-based checks break: `features/triggering.py`
  (`register_specs`, `on_condition_result`)
- UI does not reflect new saved values: `frontend/editor/index.ts`,
  `frontend/api.ts`, `bridge/websocket.py`
- Notification not sent: `features/notification.py` (`compose_send`,
  `handle_send_requested`), `controller/bus.py` (`RunBatch`), `ha/gateway.py`
- Notification delivery route or notify service failure:
  `features/notification.py`, `features/notification_services/`
- Confirmation not handled: `features/confirmation.py`, `controller/core.py`
  (`_on_action_event` publishes `action.received`)
- History entry missing or wrong: `features/history.py` (check it
  subscribes to the fact event in question), `support/history.py`

## 11. Read strategy
- Start with the exact file from the symptom map above.
- Read only the needed section and nearby functions.
- Expand only if the root cause is not clear after the first pass.
- Keep this file as the canonical map for logic discovery.

