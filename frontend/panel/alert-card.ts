import { html } from "lit";
import type { TemplateResult } from "lit";
import { formatLocalDateTime } from "../date-time.js";
import { localize } from "../localize.js";
import type { Alert, Hass } from "../types.js";

interface AlertStatus {
  className: string;
  icon: string;
  label: string;
}

interface AlertCardStatus {
  enabled: AlertStatus;
  condition: AlertStatus;
}

export interface AlertCardActions {
  onTest(alert: Alert): void;
  onToggle(alert: Alert): void;
  onEdit(alert: Alert): void;
  onShowHistory(alert: Alert): void;
  onDelete(alert: Alert): void;
}

function alertStatus(alert: Alert, hass: Hass | null): AlertCardStatus {
  let enabledStatus = {
    className: "nc-status disabled",
    icon: "mdi:pause-circle-outline",
    label: localize(hass, "alert.disabled"),
  };
  if (alert.enabled) {
    enabledStatus = {
      className: "nc-status ok",
      icon: "mdi:check-circle",
      label: localize(hass, "alert.enabled"),
    };
  }

  let conditionStatus = {
    className: "nc-status idle",
    icon: "mdi:circle-outline",
    label: localize(hass, "alert.idle"),
  };
  if (alert.runtime?.state?.active) {
    conditionStatus = {
      className: "nc-status active",
      icon: "mdi:alert-circle",
      label: localize(hass, "alert.triggered"),
    };
  }

  return { enabled: enabledStatus, condition: conditionStatus };
}

function toggleAlertLabel(alert: Alert, hass: Hass | null): string {
  return alert.enabled
    ? localize(hass, "alert.disable")
    : localize(hass, "alert.enable");
}

function monitorSummary(alert: Alert, hass: Hass | null): string {
  if (alert.monitor?.interval) {
    return localize(hass, "alert.every", { interval: alert.monitor.interval });
  }

  return "";
}

export function renderAlertCard(
  alert: Alert,
  hass: Hass | null,
  actions: AlertCardActions,
): TemplateResult {
  const status = alertStatus(alert, hass);
  const monitor = monitorSummary(alert, hass);
  const lastNotified = alert.runtime?.state?.last_notified
    ? localize(hass, "alert.last_notified", {
        time: formatLocalDateTime(
          alert.runtime.state.last_notified,
          false,
          hass?.locale,
        ),
      })
    : "";
  const metadata = [lastNotified, monitor].filter(Boolean).join(" · ");

  return html`<div class="nc-card nc-alert">
    <div class="nc-alert-icon">
      <ha-icon icon=${alert.icon || "mdi:bell-outline"}></ha-icon>
    </div>
    <div class="nc-alert-main">
      <div class="nc-alert-heading">
        <div class="nc-alert-name">${alert.name}</div>
        <div class="nc-alert-statuses">
          <span
            class=${status.enabled.className}
            role="img"
            title=${status.enabled.label}
            aria-label=${status.enabled.label}
            ><ha-icon
              icon=${status.enabled.icon}
              aria-hidden="true"
            ></ha-icon
            >${status.enabled.label}
          </span>
          <span
            class=${status.condition.className}
            role="img"
            title=${status.condition.label}
            aria-label=${status.condition.label}
            ><ha-icon
              icon=${status.condition.icon}
              aria-hidden="true"
            ></ha-icon
            >${status.condition.label}
          </span>
        </div>
      </div>
      <div class="nc-alert-meta">${metadata}</div>
    </div>
    <div class="nc-alert-actions">
      <button
        class="nc-button"
        title=${localize(hass, "alert.test")}
        aria-label=${localize(hass, "alert.test")}
        ?disabled=${!alert.enabled}
        @click=${() => actions.onTest(alert)}
      >
        <ha-icon icon="mdi:send-check-outline"></ha-icon></button
      ><button
        class="nc-button"
        title=${toggleAlertLabel(alert, hass)}
        aria-label=${toggleAlertLabel(alert, hass)}
        @click=${() => actions.onToggle(alert)}
      >
        <ha-icon
          icon=${alert.enabled
            ? "mdi:pause-circle-outline"
            : "mdi:play-circle-outline"}
        ></ha-icon></button
      ><button
        class="nc-button"
        title=${localize(hass, "alert.edit")}
        aria-label=${localize(hass, "alert.edit")}
        @click=${() => actions.onEdit(alert)}
      >
        <ha-icon icon="mdi:pencil-outline"></ha-icon></button
      ><button
        class="nc-button"
        title=${localize(hass, "alert.history")}
        aria-label=${localize(hass, "alert.history")}
        @click=${() => actions.onShowHistory(alert)}
      >
        <ha-icon icon="mdi:history"></ha-icon></button
      ><button
        class="nc-button danger"
        title=${localize(hass, "alert.delete")}
        aria-label=${localize(hass, "alert.delete")}
        @click=${() => actions.onDelete(alert)}
      >
        <ha-icon icon="mdi:delete-outline"></ha-icon>
      </button>
    </div>
  </div>`;
}