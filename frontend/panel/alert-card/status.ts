import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { localize } from "../../localize.js";
import type { Alert, AutomationRuntimeStatus, Hass } from "../../types.js";

interface AlertStatus {
  className: string;
  icon: string;
  label: string;
}

function runtimeStatus(
  automationStatus: AutomationRuntimeStatus | undefined,
  hass: Hass | null,
): AlertStatus | undefined {
  if (!automationStatus) return undefined;

  if (automationStatus.current > 0) {
    return {
      className: "nc-status active",
      icon: "mdi:progress-clock",
      label: localize(hass, "alert.automation_active"),
    };
  }

  if (automationStatus.last_triggered) {
    return {
      className: "nc-status ok",
      icon: "mdi:play-circle-outline",
      label: localize(hass, "alert.automation_last_triggered"),
    };
  }

  return {
    className: "nc-status idle",
    icon: "mdi:pause-circle-outline",
    label: localize(hass, "alert.automation_idle"),
  };
}

function enabledStatus(alert: Alert, hass: Hass | null): AlertStatus {
  return alert.enabled
    ? {
        className: "nc-status ok",
        icon: "mdi:check-circle",
        label: localize(hass, "alert.enabled"),
      }
    : {
        className: "nc-status disabled",
        icon: "mdi:pause-circle-outline",
        label: localize(hass, "alert.disabled"),
      };
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
  alert: Alert,
  hass: Hass | null,
  automationStatus: AutomationRuntimeStatus | undefined,
): TemplateResult {
  const automation = runtimeStatus(automationStatus, hass);
  return html`<div class="nc-alert-statuses">
    ${statusBadge(enabledStatus(alert, hass))}
    ${automation ? statusBadge(automation) : nothing}
  </div>`;
}