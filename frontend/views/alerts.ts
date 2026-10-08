import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { mdiDeleteOutline, mdiHistory, mdiOpenInNew, mdiPencil, mdiPlayOutline, mdiStopCircleOutline } from "@mdi/js";
import type { Alert, AutomationRuntimeStatus, Hass } from "../types.js";
import { localize } from "../localize.js";
import { actions, emptyState, type Action } from "../ui.js";

export interface AlertHandlers {
  create(): void;
  edit(alert: Alert): void;
  toggle(alert: Alert): void;
  history(alert: Alert): void;
  remove(alert: Alert): void;
  cancelRun(alert: Alert): void;
  testAlert(alert: Alert): void;
  navigate(path: string): void;
}

/** One full-width card of rows, like HA's automation and script lists. */
export const alertListStyles = css`
  .nc-alert-list {
    container-type: inline-size;
  }

  .nc-alert {
    display: flex;
    align-items: center;
    gap: var(--ha-space-4, 16px);
    min-height: 64px;
    padding: var(--ha-space-2, 8px) var(--ha-space-2, 8px) var(--ha-space-2, 8px) var(--ha-space-4, 16px);
    border-bottom: 1px solid var(--divider-color);
    cursor: pointer;
  }

  .nc-alert:last-child {
    border-bottom: 0;
  }

  .nc-alert:hover,
  .nc-alert:focus-visible {
    background: var(--secondary-background-color);
    outline: none;
  }

  .nc-alert > ha-icon {
    color: var(--state-icon-color, var(--secondary-text-color));
  }

  .nc-alert.running > ha-icon {
    color: var(--state-active-color, var(--primary-color));
  }

  .nc-alert.disabled > ha-icon,
  .nc-alert.disabled .nc-alert-name {
    color: var(--disabled-text-color);
  }

  .nc-alert-text {
    flex: 1;
    min-width: 0;
  }

  .nc-alert-name,
  .nc-alert-secondary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nc-alert-secondary {
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
  }

  .nc-alert-secondary .running {
    color: var(--success-color);
  }

  .nc-alert-controls {
    display: flex;
    align-items: center;
    gap: var(--ha-space-2, 8px);
    flex-shrink: 0;
    color: var(--primary-text-color);
    --wa-focus-ring: 2px solid var(--primary-color);
  }

  .nc-alert-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 56px;
    width: 56px;
  }

  .nc-alert-labelled-actions {
    display: none;
    align-items: center;
    gap: var(--ha-space-1, 4px);
  }

  .nc-alert-labelled-actions ha-button[variant="neutral"] {
    --wa-color-on-quiet: var(--primary-text-color);
    --wa-color-fill-quiet: color-mix(in srgb, var(--primary-text-color) 12%, transparent);
  }

  .nc-alert-labelled-actions ha-button[variant="neutral"]::part(base):focus-visible {
    background-color: var(--wa-color-fill-quiet);
  }

  @container (min-width: 1100px) {
    .nc-alert-labelled-actions {
      display: flex;
    }

    .nc-alert-labelled-actions + .nc-alert-icon-actions {
      display: none;
    }
  }
`;

function statusText(hass: Hass | null, alert: Alert, status: AutomationRuntimeStatus | undefined): string {
  if (!alert.enabled) return localize(hass, "alert.disabled");
  if (status && status.current > 0) return localize(hass, "alert.active_runs", { count: status.current });
  return localize(hass, status ? "alert.automation_idle" : "alert.enabled");
}

function menuActions(
  hass: Hass | null,
  alert: Alert,
  status: AutomationRuntimeStatus | undefined,
  on: AlertHandlers,
): Action[] {
  const localizeText = (key: string) => localize(hass, key);
  return [
    { label: localizeText("alert.history"), path: mdiHistory, action: () => on.history(alert) },
    { label: localizeText("alert.edit"), path: mdiPencil, action: () => on.edit(alert) },
    ...(status?.automation_id
      ? [{
          label: localizeText("alert.open_automation"),
          path: mdiOpenInNew,
          action: () => on.navigate(`/config/automation/edit/${encodeURIComponent(status.automation_id!)}`),
        }, {
          label: localizeText("alert.test"),
          path: mdiPlayOutline,
          action: () => on.testAlert(alert),
        }]
      : []),
    ...(status && status.current > 0
      ? [{ label: localizeText("alert.cancel_run"), path: mdiStopCircleOutline, action: () => on.cancelRun(alert), warning: true }]
      : []),
    { label: localizeText("alert.delete"), path: mdiDeleteOutline, action: () => on.remove(alert), warning: true },
  ];
}

function labelledActions(items: Action[], narrow: boolean): TemplateResult | typeof nothing {
  if (narrow) return nothing;
  return html`<div class="nc-alert-labelled-actions">
    ${items.map(item => html`<ha-button
      appearance="outlined"
      variant=${item.warning ? "danger" : "neutral"}
      size="s"
      @click=${item.action}
    ><ha-svg-icon slot="start" .path=${item.path}></ha-svg-icon>${item.label}</ha-button>`)}
  </div>`;
}

function alertRow(
  hass: Hass | null,
  alert: Alert,
  status: AutomationRuntimeStatus | undefined,
  on: AlertHandlers,
  narrow: boolean,
): TemplateResult {
  const running = Boolean(status && status.current > 0);
  const toggleLabel = localize(hass, alert.enabled ? "alert.disable" : "alert.enable");
  const items = menuActions(hass, alert, status, on);
  return html`<div
    class="nc-alert ${alert.enabled ? "" : "disabled"} ${running ? "running" : ""}"
    role="button"
    tabindex="0"
    aria-label=${`${localize(hass, "alert.edit")}: ${alert.name}`}
    @click=${() => on.edit(alert)}
    @keydown=${(event: KeyboardEvent) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      on.edit(alert);
    }}
  >
    <ha-icon icon=${alert.icon || "mdi:bell-outline"}></ha-icon>
    <div class="nc-alert-text">
      <div class="nc-alert-name">${alert.name}</div>
      <div class="nc-alert-secondary">
        ${alert.description ? html`${alert.description} · ` : nothing}<span class=${running ? "running" : ""}
          >${statusText(hass, alert, status)}</span
        >
      </div>
    </div>
    <div class="nc-alert-controls" @click=${(event: Event) => event.stopPropagation()} @keydown=${(event: Event) => event.stopPropagation()}>
      ${labelledActions(items, narrow)}
      <div class="nc-alert-icon-actions">${actions(items, narrow)}</div>
      <div class="nc-alert-toggle">
        <ha-switch
          .checked=${alert.enabled}
          aria-label=${toggleLabel}
          title=${toggleLabel}
          @change=${() => on.toggle(alert)}
        ></ha-switch>
      </div>
    </div>
  </div>`;
}

export function alertList(
  hass: Hass | null,
  alerts: Alert[],
  statuses: Record<string, AutomationRuntimeStatus>,
  activeOnly: boolean,
  on: AlertHandlers,
  narrow: boolean,
): TemplateResult {
  const visible = activeOnly ? alerts.filter((alert) => statuses[alert.id]?.current > 0) : alerts;
  if (!visible.length) {
    return activeOnly
      ? emptyState(localize(hass, "panel.no_active_alerts"))
      : emptyState(localize(hass, "panel.no_alerts"), localize(hass, "panel.create_first"), {
          label: localize(hass, "panel.create_alert"),
          run: on.create,
        });
  }
  return html`<ha-card class="nc-alert-list">${visible.map((alert) => alertRow(hass, alert, statuses[alert.id], on, narrow))}</ha-card>`;
}
