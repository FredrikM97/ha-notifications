# HA Notifications

Home Assistant integration with a Lit/TypeScript frontend. Alert configuration
is canonical; generated Home Assistant automations are derived from it.

## Start Here

Read the owner and nearest test below first, plus matching file instructions.
Load docs for unfamiliar contracts/APIs and testing skills for test work;
do not preload every skill/doc or reread evidence already available.
Paths below use `B = custom_components/ha_notifications`, `F = frontend`,
`TB = tests/backend`, `TF = tests/frontend`.

| Behavior | Owner | Nearest Test |
| --- | --- | --- |
| Setup, persistence, reconciliation | `B/__init__.py`, `B/automation_runtime.py`, `B/automation_storage.py` | `TB/test_lifecycle.py` |
| Canonical schema, runtime defaults | `B/configuration.py` | `TB/test_configuration.py` |
| Native automation generation | `B/automation.py` | `TB/test_automation.py` |
| Config-entry flow | `B/config_flow.py` | `TB/test_config_flow.py` |
| Services, delivery, targets | `B/notification.py`, `B/mobile_app.py`, `B/targets.py` | `TB/test_notification_service.py`, `TB/test_mobile_delivery.py`, `TB/test_mobile_app.py` |
| Websocket transport/contracts | `B/bridge/websocket.py`, `F/api.ts`, `F/types.ts` | `TB/test_websocket.py`, `TF/api.test.ts`, `TF/types.test.ts`, `tests/contracts/` |
| Panel state/navigation | `F/panel.ts` | `TF/panel-current.test.ts`, `TF/navigation-status.test.ts` |
| Editor drafts/finalization | `F/editor/alert-model.ts` | `TF/alert-model.test.ts` |
| Editor UI/sections/help | `F/editor/index.ts`, `F/editor/sections.ts` | `TF/editor-native-controls.test.ts`, `TF/trigger-inset.test.ts` |
| Views/shared UI | `F/views/`, `F/ui.ts` | `TF/alert-list-actions.test.ts`, `TF/history-current.test.ts`, `TF/yaml-view-current.test.ts` |
| Localization | `F/localize.ts`, `F/translations/en.json` | `TF/localize.test.ts` |

## Boundaries And Checks

- Keep persisted alert data separate from runtime state; preserve native HA trigger, condition, template, and action fields.
- Frontend owns editor draft initialization; backend nested Pydantic feature models own runtime defaults. No backend defaults endpoint.
- Do not reintroduce `controller/`, `delivery/`, `features/`, or `support/` implementation paths.
- `build/` is generated/ignored: edit authored sources. Bundles stay there until local install or HACS packaging stages them.
- Keep `README.md` short/stable: overview, install, basic usage, dashboard card snippet, docs links. Feature details/examples belong in `docs/`.
- No branches, staging, or commits without an explicit request; preserve unrelated work.
- After changing implementation instructions, review the affected current code and
	apply the requested rule to the relevant implementation in the same task. Do not
	stop at recording the rule; fix local violations and validate code changes, or
	explain why no implementation change is needed. Respect explicit instruction-only
	requests and keep the review scoped to the behavior that prompted the rule.
- Finish implementation first, then author/update tests, then validate once per coherent slice; do not rerun unchanged checks after minor edits.
- Backend: `python3 -m pytest tests/backend/test_<owner>.py`; `python3 -m ruff check custom_components/ha_notifications tests/backend`.
- Frontend: `npx vitest run tests/frontend/<owner>.test.ts`; `npm run typecheck`; `npm run build`. Check UI behavior in real HA with `npm run dev`.
- Implementation handoff: `sh scripts/validate.sh`. Instruction-only changes: read-only syntax/scope checks, not application tests/builds.
- Setup/install/packaging: `docs/development.md`; test-specific fixtures/snapshots: `tests/AGENTS.md` and applicable testing skills.