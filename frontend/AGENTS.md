# Frontend

Authored TypeScript/Lit for the HA Notifications panel and Lovelace card. Keep
it small: a new view or editor section should be a few lines of declaration,
not new infrastructure.

## Layout

```
panel.ts          Panel + card entry point; state, API calls, tab routing.
api.ts            The only Home Assistant websocket boundary.
types.ts          Frontend contracts mirroring the backend schema.
ui.ts             Generic UI on HA elements: toolbar, actions, navMenu,
                  emptyState, notify, NarrowController, selectConfig.
localize.ts       Translations (`translations/en.json`).
editor/
  index.ts        The alert editor element (app bar, nav, form, dialogs).
  sections.ts     Section catalog: one declarative entry per section.
  alert-model.ts  Alert defaults, trigger helpers, and canonical finalization.
views/
  alerts.ts       Alert list (template function, no custom element).
  history.ts      History view plus its pure filter/group/format helpers.
  yaml.ts         Native Home Assistant YAML editor view.
```

Do not create a folder for a single file or a module for a single caller;
put the code next to its only user. Split a file only when two real owners
need it.

## Use Home Assistant's components

Build UI from the elements Home Assistant already loads, not custom widgets:
`ha-top-app-bar-fixed`, `ha-tab-group`, `ha-card`, `ha-button`,
`ha-icon-button`, `ha-icon-overflow-menu`, `ha-dropdown`, `ha-dialog`,
`ha-settings-row`, `ha-form`, `ha-selector` (incl. trigger, condition, action,
template, target, duration), and `ha-yaml-editor`. Icons come from `@mdi/js`.
Show feedback with `notify()` (HA's snackbar), not a custom toast.

Use HA theme variables (`--primary-text-color`, `--divider-color`,
`--ha-space-*`, ...) for any CSS. Keep custom CSS to layout only.

## Shared patterns

- Every card view starts with `toolbar(start, actions, narrow, primary?)`:
  leading content (search, title or text), icon actions that collapse into ⋮
  below HA's 870px breakpoint, and at most one main button.
- Filters go in a `.nc-filters` grid below the toolbar; it reflows on its own.
- Responsive behaviour comes from `NarrowController` (measures the element, so
  panel and card behave the same), not media queries.
- Navigation uses `navMenu()`: a side list when wide, a dropdown when narrow.
- Editor sections are `ha-form` schemas in `editor/sections.ts`; add a section
  by adding a catalog entry. Keep `ha-selector`/`ha-form` config objects
  stable between renders (`selectConfig()`, the editor's schema cache), or HA
  rebuilds the control.
- Reuse the editor's `labelWithHelp()` for adjacent label/section help.
  Section info stays beside the heading, never in a code editor; boolean help
  stays immediately after label text in `.nc-heading`, with the native switch
  separate in the shared `.nc-option.nc-option-inline` row.

## Validation

Finish related edits first, then run `npm run typecheck` and `npm run build`.
For UI behaviour, check it in a real Home Assistant with `npm run dev`
(see `docs/development.md`) before handoff.
