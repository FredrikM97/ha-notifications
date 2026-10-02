import { html } from "lit";
import type { TemplateResult } from "lit";
import { localize } from "../../localize.js";
import type { AutomationRuntimeStatus, Hass } from "../../types.js";

interface AlertStatus {
  className: string;
  icon: string;
  label: string;
}

function runtimeStatuses(
  automationStatus: AutomationRuntimeStatus | undefined,
  hass: Hass | null,
): AlertStatus[] {
  if (!automationStatus) return [];
  const statuses: AlertStatus[] = [];

  if (automationStatus.current > 0) {
    statuses.push({
      className: "nc-status triggered",
      icon: "mdi:progress-clock",
      label: localize(hass, "alert.automation_triggered"),
    });
    statuses.push({
      className: "nc-status run-count",
      icon: "mdi:play-circle-outline",
      label: localize(hass, "alert.active_runs", {
        count: automationStatus.current,
      }),
    });
  }

  return statuses.length
    ? statuses
    : [{
        className: "nc-status idle",
        icon: "mdi:pause-circle-outline",
        label: localize(hass, "alert.automation_idle"),
      }];
}

function statusBadge(status: AlertStatus): TemplateResult {
  return html`<span
    class=${status.className}
    role="img"
    title=${status.label}
    aria-label=${status.label}
    ><ha-icon icon=${status.icon} aria-hidden="true"></ha-icon>${status.label}</span
  >`;
}

export function alertStatusTemplate(
  hass: Hass | null,
  automationStatus: AutomationRuntimeStatus | undefined,
): TemplateResult {
  const automation = runtimeStatuses(automationStatus, hass);
  return html`<div class="nc-alert-statuses">${automation.map(statusBadge)}</div>`;
}
