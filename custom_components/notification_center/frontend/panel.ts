import {
  discardDraftTestPayload,
  deleteAlert,
  errorMessage,
  getAlerts,
  getHistory,
  loadRegistries,
  saveAlert,
  testAlert,
  testAlertPayload,
  validateConditions,
} from "./api.js";

import { openEditor } from "./editor.js";

import { renderHistory } from "./history.js";

import { styles } from "./styles.js";
import { html, render } from "lit";
import type { Alert, Hass, HistoryEntry, Registries } from "./types.js";
import { renderYamlView } from "./yaml-view.js";

type PanelTab = "alerts" | "history" | "yaml";

interface PanelTabDefinition {
  key: PanelTab;
  label: string;
}

interface AlertStatus {
  className: string;
  icon: string;
  label: string;
}

interface AlertCardStatus {
  enabled: AlertStatus;
  condition: AlertStatus;
}

const panelTabs: PanelTabDefinition[] = [
  { key: "alerts", label: "Alerts" },
  { key: "history", label: "History" },
  { key: "yaml", label: "YAML" },
];

function tabContent(tab: PanelTab) {
  if (tab === "alerts") {
    return html`<div id="alerts-view"></div>`;
  }
  if (tab === "history") {
    return html`<div id="history-view"></div>`;
  }
  return html`<div id="yaml-view"></div>`;
}

function alertStatus(alert: Alert): AlertCardStatus {
  return {
    enabled: alert.enabled
      ? { className: "nc-status ok", icon: "mdi:check-circle", label: "Enabled" }
      : {
          className: "nc-status disabled",
          icon: "mdi:pause-circle-outline",
          label: "Disabled",
        },
    condition: alert.runtime?.active
      ? {
          className: "nc-status active",
          icon: "mdi:alert-circle",
          label: "Triggered",
        }
      : { className: "nc-status idle", icon: "mdi:circle-outline", label: "Idle" },
  };
}

class NotificationCenterPanel extends HTMLElement {
  private _hass: Hass | null = null;
  private alerts: Alert[] = [];
  private history: HistoryEntry[] = [];
  private historyAlertId: string | null = null;
  private historyAlertName: string | null = null;
  private tab: PanelTab = "alerts";
  private loading = false;
  private _registries: Registries | null = null;
  private _registriesPromise: Promise<Registries> | null = null;
  private _initialized = false;

  constructor() {
    super();

    this.attachShadow({
      mode: "open",
    });

    this._hass = null;
    this.alerts = [];
    this.history = [];
    this.historyAlertId = null;
    this.historyAlertName = null;
    this.tab = "alerts";
    this.loading = false;
    this._registries = null;
    this._registriesPromise = null;
  }

  set hass(value: Hass) {
    this._hass = value;

    if (this.isConnected && !this._initialized) {
      this._initialized = true;
      this.refresh();
    }
  }

  get hass() {
    return this._hass;
  }

  protected isAdmin(): boolean {
    return Boolean(this._hass?.user?.is_admin);
  }

  async getRegistries(): Promise<Registries> {
    if (this._registries) {
      return this._registries;
    }

    if (!this._registriesPromise) {
      this._registriesPromise = loadRegistries(this._hass)
        .then((registries) => {
          this._registries = registries;
          return registries;
        })
        .catch((err) => {
          this._registriesPromise = null;
          throw err;
        });
    }

    return this._registriesPromise;
  }

  connectedCallback() {
    this.render();

    if (this._hass) {
      this._initialized = true;

      this.refresh();
    }
  }

  async refresh() {
    if (!this._hass || !this.isAdmin()) {
      return;
    }

    this.loading = true;

    try {
      [this.alerts, this.history] = await Promise.all([
        getAlerts(this._hass),
        getHistory(this._hass, this.historyAlertId, 150),
      ]);
      if (this.historyAlertId) {
        this.historyAlertName =
          this.alerts.find((alert) => alert.id === this.historyAlertId)?.name ||
          this.historyAlertName;
      }
    } catch (err) {
      this.showToast(errorMessage(err), true);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  render(): void {
    if (!this.shadowRoot) {
      return;
    }
    if (!this.isAdmin()) {
      render(
        html`<style>
            ${styles}
          </style>
          <div class="nc-page">
            <div class="nc-card nc-empty">
              <h2>Administrator access required</h2>
              <p>
                HA Notifications alerts can only be viewed and edited by
                Home Assistant administrators.
              </p>
            </div>
          </div>`,
        this.shadowRoot,
      );
      return;
    }
    const content = tabContent(this.tab);
    render(
      html`<style>
          ${styles}
        </style>
        <div class="nc-page">
          <div class="nc-header">
            <div class="nc-title">
              <div class="nc-title-icon">🔔</div>
              <div>
                <h1>HA Notifications</h1>
                <p>Manage alerts, notifications and debug history.</p>
              </div>
            </div>
            <div class="nc-actions">
              <button class="nc-button" @click=${() => this.addAlert()}>
                + Add alert
              </button>
            </div>
          </div>
          <div class="nc-tabs">
            ${panelTabs.map(
              ({ key, label }) =>
                html`<button
                  class="nc-tab ${this.tab === key ? "active" : ""}"
                  @click=${() => {
                    this.tab = key;
                    this.render();
                  }}
                >
                  ${label}
                </button>`,
            )}
          </div>
          ${content}
        </div>`,
      this.shadowRoot,
    );
    if (this.tab === "alerts")
      this.renderAlerts(this.shadowRoot.querySelector("#alerts-view")!);
    if (this.tab === "history")
      renderHistory(
        this.shadowRoot.querySelector("#history-view")!,
        this.history,
        {
          alertName: this.historyAlertName,
          onAlertSelected: (alertId, alertName) =>
            this.showHistoryForAlert(alertId, alertName),
          onShowAll: () => this.showAllHistory(),
        },
      );
    if (this.tab === "yaml" && this._hass)
      renderYamlView(
        this.shadowRoot.querySelector("#yaml-view")!,
        this._hass,
        (message, error) => this.showToast(message, error),
        () => this.refresh(),
      );
  }

  renderAlerts(container: HTMLElement): void {
    render(
      this.alerts.length
        ? html`<div class="nc-alerts">
            ${this.alerts.map((alert) => this.alertCardTemplate(alert))}
          </div>`
        : html`<div class="nc-card nc-empty">
            <h2>No alerts yet</h2>
            <p>
              Create your first alert. You can trigger it from condition
              changes, an interval, or both.
            </p>
            <button class="nc-button" @click=${() => this.addAlert()}>
              Create alert
            </button>
          </div>`,
      container,
    );
  }

  private alertCardTemplate(alert: Alert) {
    const runtime = alert.runtime || {};
    const status = alertStatus(alert);
    const monitor =
      [
        alert.monitor?.on_change ? "condition changes" : "",
        alert.monitor?.interval ? `every ${alert.monitor.interval}` : "",
      ]
        .filter(Boolean)
        .join(" + ") || "No trigger";
    return html`<div class="nc-card nc-alert">
      <div class="nc-alert-icon">
        <ha-icon icon=${alert.icon || "mdi:bell-outline"}></ha-icon>
      </div>
      <div class="nc-alert-main">
        <div class="nc-alert-name">${alert.name}</div>
        <div class="nc-alert-statuses">
          <span class=${status.enabled.className}
            ><ha-icon icon=${status.enabled.icon}></ha-icon
            >${status.enabled.label}</span
          >
          <span class=${status.condition.className}
            ><ha-icon icon=${status.condition.icon}></ha-icon
            >${status.condition.label}</span
          >
        </div>
        <div class="nc-alert-meta">
          ${monitor} · ${this.targetSummary(alert.notification?.target)}
        </div>
        <div class="nc-alert-meta">
          ${runtime.last_notified
            ? `Last notification: ${this.formatTime(runtime.last_notified)}`
            : "No notification sent yet"}
        </div>
      </div>
      <div class="nc-alert-actions">
        <button
          class="nc-button"
          ?disabled=${!alert.enabled}
          @click=${() => this.testAlertFromCard(alert)}
        >
          Test</button
        ><button class="nc-button" @click=${() => this.toggleAlert(alert)}>
          ${alert.enabled ? "Disable" : "Enable"}</button
        ><button class="nc-button" @click=${() => this.editAlert(alert)}>
          Edit</button
        ><button class="nc-button" @click=${() => this.showAlertHistory(alert)}>
          History</button
        ><button
          class="nc-button danger"
          @click=${() => this.removeAlert(alert)}
        >
          Delete
        </button>
      </div>
    </div>`;
  }

  private async testAlertFromCard(alert: Alert) {
    try {
      await testAlert(this._hass, alert.id);
      this.showToast("Test notification sent.");
      await this.refresh();
    } catch (err) {
      this.showToast(errorMessage(err), true);
    }
  }

  private async showAlertHistory(alert: Alert): Promise<void> {
    await this.showHistoryForAlert(alert.id, alert.name);
  }

  private async showHistoryForAlert(
    alertId: string,
    alertName: string,
  ): Promise<void> {
    if (!this._hass) return;

    this.historyAlertId = alertId;
    this.historyAlertName = alertName;
    this.tab = "history";
    this.loading = true;
    this.render();

    try {
      this.history = await getHistory(this._hass, alertId, 150);
    } catch (err) {
      this.showToast(errorMessage(err), true);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async showAllHistory(): Promise<void> {
    if (!this._hass) return;

    this.historyAlertId = null;
    this.historyAlertName = null;
    this.tab = "history";
    this.loading = true;
    this.render();

    try {
      this.history = await getHistory(this._hass, null, 150);
    } catch (err) {
      this.showToast(errorMessage(err), true);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async toggleAlert(alert: Alert) {
    try {
      await saveAlert(this._hass, { ...alert, enabled: !alert.enabled });
      this.showToast(alert.enabled ? "Alert disabled." : "Alert enabled.");
      await this.refresh();
    } catch (err) {
      this.showToast(errorMessage(err), true);
    }
  }

  targetSummary(target: Alert["notification"]["target"] = {}): string {
    const parts: string[] = [];

    for (const [key, label] of [
      ["device_id", "devices"],
      ["area_id", "areas"],
      ["floor_id", "floors"],
      ["label_id", "labels"],
      ["entity_id", "entities"],
    ]) {
      const count = target[key]?.length || 0;

      if (count) {
        parts.push(`${count} ${label}`);
      }
    }

    return parts.join(", ") || "No target";
  }

  addAlert = async () => {
    let registries: Registries;
    try {
      registries = await this.getRegistries();
    } catch (err) {
      this.showToast(errorMessage(err), true);
      return;
    }

    openEditor({
      root: this.shadowRoot,
      alert: null,
      registries,
      onTest: async (draft) => {
        const result = await testAlertPayload(this._hass, draft);
        this.showToast("Draft test notification sent.");
        return result;
      },
      onValidateCondition: async (draft) => {
        await validateConditions(this._hass, draft);
        this.showToast("Condition is valid.");
      },
      onDiscardTest: async (sessionId) => {
        await discardDraftTestPayload(this._hass, sessionId);
      },
      onSave: async (alert) => {
        const saved = await saveAlert(this._hass, alert);

        this.showToast("Alert created.");

        return saved;
      },
      onSaved: async () => {
        await this.refresh();
      },
    });
  };

  async editAlert(alert: Alert): Promise<void> {
    let registries: Registries;
    try {
      registries = await this.getRegistries();
    } catch (err) {
      this.showToast(errorMessage(err), true);
      return;
    }

    openEditor({
      root: this.shadowRoot,
      alert,
      registries,
      onTest: async (draft) => {
        const result = await testAlertPayload(this._hass, draft);
        this.showToast("Draft test notification sent.");
        return result;
      },
      onValidateCondition: async (draft) => {
        await validateConditions(this._hass, draft);
        this.showToast("Condition is valid.");
      },
      onDiscardTest: async (sessionId) => {
        await discardDraftTestPayload(this._hass, sessionId);
      },
      onSave: async (updated) => {
        const saved = await saveAlert(this._hass, updated);

        this.alerts = this.alerts.map((item) =>
          item.id === saved.id
            ? {
                ...item,
                ...saved,
                runtime: item.runtime,
              }
            : item,
        );

        this.showToast("Alert saved.");
        return saved;
      },
      onSaved: async () => {
        await this.refresh();
      },
    });
  }

  async removeAlert(alert: Alert): Promise<void> {
    if (!window.confirm(`Delete "${alert.name}"?`)) {
      return;
    }

    try {
      await deleteAlert(this._hass, alert.id);

      this.showToast("Alert deleted.");

      await this.refresh();
    } catch (err) {
      this.showToast(errorMessage(err), true);
    }
  }

  formatTime(value: string | undefined): string {
    if (!value) {
      return "—";
    }

    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value));
    } catch (_err) {
      return value;
    }
  }

  showToast(message: string, error = false): void {
    const toast = document.createElement("div");

    toast.className = "nc-toast";

    toast.textContent = message;

    if (error) {
      toast.style.background = "var(--error-color)";
      toast.style.color = "white";
    }

    this.shadowRoot.appendChild(toast);

    setTimeout(() => toast.remove(), 3500);
  }
}

if (!customElements.get("notification-center-panel")) {
  customElements.define("notification-center-panel", NotificationCenterPanel);
}

interface NotificationCenterCardConfig {
  type: "custom:ha-notifications-card" | "custom:notification-center-card";
}

class NotificationCenterCard extends NotificationCenterPanel {
  private config: NotificationCenterCardConfig | null = null;

  setConfig(config: NotificationCenterCardConfig): void {
    if (
      !config ||
      !["custom:ha-notifications-card", "custom:notification-center-card"].includes(
        config.type,
      )
    ) {
      throw new Error("Card type must be custom:ha-notifications-card.");
    }
    this.config = config;
    this.render();
  }

  getCardSize(): number {
    return 12;
  }

  static getStubConfig(): NotificationCenterCardConfig {
    return { type: "custom:ha-notifications-card" };
  }
}

if (!customElements.get("ha-notifications-card")) {
  customElements.define("ha-notifications-card", NotificationCenterCard);
}

if (!customElements.get("notification-center-card")) {
  customElements.define("notification-center-card", NotificationCenterCard);
}

const customCardWindow = window as Window & {
  customCards?: Array<{
    type: string;
    name: string;
    description: string;
  }>;
};
customCardWindow.customCards = customCardWindow.customCards || [];
for (const card of [
  {
    type: "ha-notifications-card",
    name: "HA Notifications",
    description: "Manage HA Notifications alerts, history, and YAML.",
  },
  {
    type: "notification-center-card",
    name: "HA Notifications (legacy alias)",
    description: "Legacy alias for HA Notifications.",
  },
]) {
  if (!customCardWindow.customCards.some((item) => item.type === card.type)) {
    customCardWindow.customCards.push(card);
  }
}
