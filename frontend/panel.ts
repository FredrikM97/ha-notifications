import {
  deleteAlert,
  errorMessage,
  getAlerts,
  getAlertRuntime,
  getHistory,
  loadRegistries,
  saveAlert,
  previewAlertPayload,
  validateConditions,
} from "./api.js";
import { openEditor } from "./editor/index.js";
import { formatLocalDateTime } from "./date-time.js";
import "./history.js";
import type { HistoryFilters, HistoryRenderOptions } from "./history.js";
import { styles } from "./styles.js";
import { showToast as showToastOn, toastListTemplate } from "./toast.js";
import type { Toast } from "./toast.js";
import { LitElement, html } from "lit";
import type { TemplateResult } from "lit";
import type {
  Alert,
  Hass,
  Registries,
  RuntimeAlertHistoryEntry,
  RuntimeAlertState,
} from "./types.js";
import "./yaml-view.js";

type PanelTab = "alerts" | "history" | "yaml" | "debug";

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

interface HaNotificationsCardConfig {
  type: "custom:ha-notifications-card";
}

const panelTabs: PanelTabDefinition[] = [
  { key: "alerts", label: "Alerts" },
  { key: "history", label: "History" },
  { key: "yaml", label: "YAML" },
  { key: "debug", label: "Active" },
];

function alertStatus(alert: Alert): AlertCardStatus {
  let enabledStatus = {
    className: "nc-status disabled",
    icon: "mdi:pause-circle-outline",
    label: "Disabled",
  };
  if (alert.enabled) {
    enabledStatus = {
      className: "nc-status ok",
      icon: "mdi:check-circle",
      label: "Enabled",
    };
  }

  let conditionStatus = {
    className: "nc-status idle",
    icon: "mdi:circle-outline",
    label: "Idle",
  };
  if (alert.runtime?.state?.active) {
    conditionStatus = {
      className: "nc-status active",
      icon: "mdi:alert-circle",
      label: "Triggered",
    };
  }

  return {
    enabled: enabledStatus,
    condition: conditionStatus,
  };
}

function activeTabClass(active: boolean): string {
  const classes = ["nc-tab"];
  if (active) {
    classes.push("active");
  }

  return classes.join(" ");
}

function toggleAlertLabel(alert: Alert): string {
  if (alert.enabled) {
    return "Disable";
  }

  return "Enable";
}

function toggleAlertToast(alert: Alert): string {
  if (alert.enabled) {
    return "Alert disabled.";
  }

  return "Alert enabled.";
}

interface DebugAlertEntry {
  alert: Alert;
  runtime: RuntimeAlertState;
}

function debugPayload(
  alerts: Alert[],
  runtime: Record<string, RuntimeAlertState>,
): DebugAlertEntry[] {
  return alerts.flatMap((alert) => {
    const runtimeState = runtime[alert.id];
    if (!alert.runtime?.state?.active || !runtimeState?.state?.active) {
      return [];
    }
    return [{ alert, runtime: runtimeState }];
  });
}

class HaNotificationsPanel extends LitElement {
  private _hass: Hass | null = null;
  private alerts: Alert[] = [];
  private runtime: Record<string, RuntimeAlertState> = {};
  private history: RuntimeAlertHistoryEntry[] = [];
  private historyAlertId: string | null = null;
  private historyAlertName: string | null = null;
  private historyFilters: HistoryFilters = {
    search: "",
    alertId: "",
    type: "",
    severity: "",
  };
  private tab: PanelTab = "alerts";
  private loading = false;
  private refreshing = false;
  private refreshTimer: number | null = null;
  private _registries: Registries | null = null;
  private _registriesPromise: Promise<Registries> | null = null;
  private _initialized = false;
  private editorActive = false;
  toasts: Toast[] = [];

  set hass(value: Hass) {
    this._hass = value;
    this.requestUpdate();

    if (this.isConnected && !this._initialized) {
      this._initialized = true;
      void this.refresh();
    }
  }

  get hass() {
    return this._hass;
  }

  protected isAdmin(): boolean {
    return Boolean(this._hass?.user?.is_admin);
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.startAutoRefresh();

    if (this._hass) {
      this._initialized = true;
      void this.refresh();
    }
  }

  disconnectedCallback(): void {
    this.stopAutoRefresh();
    super.disconnectedCallback();
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

  private startAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      return;
    }

    this.refreshTimer = window.setInterval(() => {
      void this.refresh({ silent: true });
    }, 5000);
  }

  private stopAutoRefresh(): void {
    if (this.refreshTimer === null) {
      return;
    }

    window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private editorOpen(): boolean {
    return this.editorActive || this.tab === "yaml";
  }

  async refresh({ silent = false }: { silent?: boolean } = {}): Promise<void> {
    if (!this._hass || !this.isAdmin() || this.refreshing) {
      return;
    }

    if (silent && this.editorOpen()) {
      return;
    }

    this.refreshing = true;
    if (!silent) {
      this.loading = true;
    }
    this.requestUpdate();

    try {
      const [alertsResult, runtimeResult, historyResult] =
        await Promise.allSettled([
          getAlerts(this._hass),
          getAlertRuntime(this._hass),
          getHistory(this._hass, this.historyAlertId, 150),
        ]);

      if (alertsResult.status === "fulfilled") {
        const runtimeByAlert =
          runtimeResult.status === "fulfilled" ? runtimeResult.value : {};
        this.alerts = alertsResult.value.map((alert) => ({
          ...alert,
          runtime: runtimeByAlert[alert.id],
        }));
        this.refreshHistoryAlertName();
      } else if (!silent) {
        this.showToast(errorMessage(alertsResult.reason), true);
      }

      if (runtimeResult.status === "fulfilled") {
        this.runtime = runtimeResult.value;
      } else if (!silent) {
        this.showToast(errorMessage(runtimeResult.reason), true);
      }

      if (historyResult.status === "fulfilled") {
        this.history = historyResult.value;
      } else if (!silent) {
        this.showToast(errorMessage(historyResult.reason), true);
      }
    } finally {
      this.refreshing = false;
      if (!silent) {
        this.loading = false;
      }
      this.requestUpdate();
    }
  }

  render() {
    if (!this.isAdmin()) {
      return html`${this.styleTemplate()}${this.adminRequiredTemplate()}${toastListTemplate(
        this.toasts,
      )}`;
    }

    return html`${this.styleTemplate()}
      <div class="nc-page" ?hidden=${this.editorActive}>
        ${this.headerTemplate()}${this.tabsTemplate()}${this.tabTemplate()}
      </div>
      ${toastListTemplate(this.toasts)}`;
  }

  private styleTemplate(): TemplateResult {
    return html`<style>
      ${styles}
    </style>`;
  }

  private adminRequiredTemplate(): TemplateResult {
    return html`<div class="nc-page">
      <div class="nc-card nc-empty">
        <h2>Administrator access required</h2>
        <p>
          HA Notifications alerts can only be viewed and edited by Home
          Assistant administrators.
        </p>
      </div>
    </div>`;
  }

  private headerTemplate(): TemplateResult {
    return html`<div class="nc-header">
      <a
        class="nc-back-button"
        href="/"
        aria-label="Back to Home Assistant"
        title="Back to Home Assistant"
        @click=${this.navigateHome}
      >
        <ha-icon icon="mdi:arrow-left"></ha-icon>
      </a>
      <div class="nc-title">
        <div class="nc-title-icon">
          <ha-icon icon="mdi:bell-badge"></ha-icon>
        </div>
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
    </div>`;
  }

  private navigateHome(event: Event): void {
    if (!this._hass?.navigate) {
      return;
    }

    event.preventDefault();
    this._hass.navigate("/");
  }

  private tabsTemplate(): TemplateResult {
    return html`<div class="nc-tabs">
      ${panelTabs.map(
        ({ key, label }) =>
          html`<button
            class=${activeTabClass(this.tab === key)}
            @click=${() => this.selectTab(key)}
          >
            ${label}
          </button>`,
      )}
    </div>`;
  }

  private tabTemplate(): TemplateResult {
    if (this.tab === "alerts") {
      return this.alertsTemplate();
    }

    if (this.tab === "history") {
      return html`<ha-notifications-history-view
        .history=${this.history}
        .options=${this.historyViewOptions()}
      ></ha-notifications-history-view>`;
    }

    if (this.tab === "debug") {
      return this.debugTemplate();
    }

    return html`<ha-notifications-yaml-view
      .hass=${this._hass}
      .showToast=${(message: string, error?: boolean) =>
        this.showToast(message, error)}
      .refreshPanel=${() => this.refresh()}
    ></ha-notifications-yaml-view>`;
  }

  private debugTemplate(): TemplateResult {
    const entries = debugPayload(this.alerts, this.runtime);
    if (!entries.length) {
      return html`<div class="nc-card nc-empty">
        <h2>No active alerts</h2>
      </div>`;
    }

    return html`<div class="nc-debug-list">
      ${entries.map(
        ({ alert, runtime }) => html`
          <details class="nc-debug-alert" open>
            <summary>
              <span>${alert.name}</span>
              <code>${alert.id}</code>
            </summary>
            <div class="nc-debug-sections">
              <details class="nc-debug-section" open>
                <summary>State</summary>
                <pre>${JSON.stringify(runtime.state ?? {}, null, 2)}</pre>
              </details>
              <details class="nc-debug-section">
                <summary>Trace (${runtime.trace?.length ?? 0})</summary>
                <pre>${JSON.stringify(runtime.trace ?? [], null, 2)}</pre>
              </details>
            </div>
          </details>
        `,
      )}
    </div>`;
  }

  private alertsTemplate(): TemplateResult {
    if (this.alerts.length) {
      return html`<div class="nc-alerts">
        ${this.alerts.map((alert) => this.alertCardTemplate(alert))}
      </div>`;
    }

    return html`<div class="nc-card nc-empty">
      <h2>No alerts yet</h2>
      <p>
        Create your first alert. You can trigger it from condition changes, an
        interval, or both.
      </p>
      <button class="nc-button" @click=${() => this.addAlert()}>
        Create alert
      </button>
    </div>`;
  }

  private historyViewOptions(): HistoryRenderOptions {
    return {
      alertName: this.historyAlertName,
      hass: this._hass || undefined,
      locale: this._hass?.locale,
      alerts: this.alerts.map((alert) => ({
        id: alert.id,
        name: alert.name,
      })),
      filters: this.historyFilters,
      types: [
        ...new Set(this.history.map((item) => item.event?.type).filter(Boolean)),
      ] as string[],
      onFiltersChanged: (filters) => {
        this.historyFilters = filters;
        this.requestUpdate();
      },
      onAlertSelected: (alertId, alertName) =>
        this.showHistoryForAlert(alertId, alertName),
      onShowAll: () => this.showAllHistory(),
    };
  }

  private selectTab(tab: PanelTab): void {
    this.tab = tab;
    this.requestUpdate();
  }

  private refreshHistoryAlertName(): void {
    if (!this.historyAlertId) {
      return;
    }

    const alert = this.alerts.find((item) => item.id === this.historyAlertId);
    if (alert) {
      this.historyAlertName = alert.name;
    }
  }

  private alertCardTemplate(alert: Alert): TemplateResult {
    const status = alertStatus(alert);
    const monitor = this.monitorSummary(alert);
    const lastNotified = alert.runtime?.state?.last_notified
      ? `Last notified: ${formatLocalDateTime(
          alert.runtime.state.last_notified,
          false,
          this._hass?.locale,
        )}`
      : "";
    const target = this.targetSummary(alert.notification?.target);
    const metadata = [lastNotified, monitor, target]
      .filter(Boolean)
      .join(" · ");

    return html`<div class="nc-card nc-alert">
      <div class="nc-alert-icon">
        <ha-icon icon=${alert.icon || "mdi:bell-outline"}></ha-icon>
      </div>
      <div class="nc-alert-main">
        <div class="nc-alert-heading">
          <div class="nc-alert-name">${alert.name}</div>
          <div class="nc-alert-statuses">
            <span class=${status.enabled.className}
              ><ha-icon icon=${status.enabled.icon}></ha-icon>${status.enabled
                .label}</span
            >
            <span class=${status.condition.className}
              ><ha-icon icon=${status.condition.icon}></ha-icon>${status
                .condition.label}</span
            >
          </div>
        </div>
        <div class="nc-alert-meta">
          ${metadata}
        </div>
      </div>
      <div class="nc-alert-actions">
        <button
          class="nc-button"
          title="Test alert"
          aria-label="Test alert"
          ?disabled=${!alert.enabled}
          @click=${() => this.testAlertFromCard(alert)}
        >
          <ha-icon icon="mdi:send-check-outline"></ha-icon></button
        ><button
          class="nc-button"
          title=${toggleAlertLabel(alert)}
          aria-label=${toggleAlertLabel(alert)}
          @click=${() => this.toggleAlert(alert)}
        >
          <ha-icon
            icon=${alert.enabled
              ? "mdi:pause-circle-outline"
              : "mdi:play-circle-outline"}
          ></ha-icon></button
        ><button
          class="nc-button"
          title="Edit alert"
          aria-label="Edit alert"
          @click=${() => this.editAlert(alert)}
        >
          <ha-icon icon="mdi:pencil-outline"></ha-icon></button
        ><button
          class="nc-button"
          title="View history"
          aria-label="View history"
          @click=${() => this.showAlertHistory(alert)}
        >
          <ha-icon icon="mdi:history"></ha-icon></button
        ><button
          class="nc-button danger"
          title="Delete alert"
          aria-label="Delete alert"
          @click=${() => this.removeAlert(alert)}
        >
          <ha-icon icon="mdi:delete-outline"></ha-icon>
        </button>
      </div>
    </div>`;
  }

  private monitorSummary(alert: Alert): string {
    const parts: string[] = [];
    if (alert.monitor?.interval) {
      parts.push(`every ${alert.monitor.interval}`);
    }

    const summary = parts.join(" + ");
    if (summary) {
      return summary;
    }

    return "";
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

  addAlert = async (): Promise<void> => {
    let registries: Registries;
    try {
      registries = await this.getRegistries();
    } catch (err) {
      this.showToast(errorMessage(err), true);
      return;
    }

    this.editorActive = true;
    this.requestUpdate();
    openEditor({
      root: this.renderRoot as ShadowRoot,
      hass: this._hass!,
      alert: null,
      registries,
      onTest: async (draft) => {
        const result = await previewAlertPayload(this._hass, draft);
        this.showToast("Draft test notification sent.");
        return result;
      },
      onValidateCondition: async (draft) => {
        await validateConditions(this._hass, draft);
        this.showToast("Condition is valid.");
      },
      onSave: async (alert) => {
        const saved = await saveAlert(this._hass, alert);
        this.showToast("Alert created.");
        return saved;
      },
      onSaved: async () => {
        await this.refresh();
      },
      onClosed: () => {
        this.editorActive = false;
        this.requestUpdate();
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

    this.editorActive = true;
    this.requestUpdate();
    openEditor({
      root: this.renderRoot as ShadowRoot,
      hass: this._hass!,
      alert,
      registries,
      onTest: async (draft) => {
        const result = await previewAlertPayload(this._hass, draft);
        this.showToast("Draft test notification sent.");
        return result;
      },
      onValidateCondition: async (draft) => {
        await validateConditions(this._hass, draft);
        this.showToast("Condition is valid.");
      },
      onSave: async (updated) => {
        const saved = await saveAlert(this._hass, updated);
        this.replaceSavedAlert(saved);
        this.showToast("Alert saved.");
        return saved;
      },
      onSaved: async () => {
        await this.refresh();
      },
      onClosed: () => {
        this.editorActive = false;
        this.requestUpdate();
      },
    });
  }

  private replaceSavedAlert(saved: Alert): void {
    this.alerts = this.alerts.map((item) => {
      if (item.id === saved.id) {
        return {
          ...item,
          ...saved,
          runtime: item.runtime,
        };
      }

      return item;
    });
    this.requestUpdate();
  }

  private async testAlertFromCard(alert: Alert): Promise<void> {
    try {
      await previewAlertPayload(this._hass, alert);
      this.showToast("Test notification sent.");
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
    if (!this._hass) {
      return;
    }

    this.historyAlertId = alertId;
    this.historyAlertName = alertName;
    this.historyFilters = {
      search: "",
      alertId: "",
      type: "",
      severity: "",
    };
    this.tab = "history";
    this.loading = true;
    this.requestUpdate();

    try {
      this.history = await getHistory(this._hass, alertId, 150);
    } catch (err) {
      this.showToast(errorMessage(err), true);
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  private async showAllHistory(): Promise<void> {
    if (!this._hass) {
      return;
    }

    this.historyAlertId = null;
    this.historyAlertName = null;
    this.historyFilters = {
      search: "",
      alertId: "",
      type: "",
      severity: "",
    };
    this.tab = "history";
    this.loading = true;
    this.requestUpdate();

    try {
      this.history = await getHistory(this._hass, null, 150);
    } catch (err) {
      this.showToast(errorMessage(err), true);
    } finally {
      this.loading = false;
      this.requestUpdate();
    }
  }

  private async toggleAlert(alert: Alert): Promise<void> {
    try {
      await saveAlert(this._hass, { ...alert, enabled: !alert.enabled });
      this.showToast(toggleAlertToast(alert));
      await this.refresh();
    } catch (err) {
      this.showToast(errorMessage(err), true);
    }
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
    return formatLocalDateTime(value, false, this._hass?.locale);
  }

  showToast(message: string, error = false): void {
    showToastOn(this, message, error);
  }
}

if (!customElements.get("ha-notifications-panel")) {
  customElements.define("ha-notifications-panel", HaNotificationsPanel);
}

class HaNotificationsCard extends HaNotificationsPanel {
  private config: HaNotificationsCardConfig | null = null;

  setConfig(config: HaNotificationsCardConfig): void {
    if (!config || config.type !== "custom:ha-notifications-card") {
      throw new Error("Card type must be custom:ha-notifications-card.");
    }
    this.config = config;
    this.requestUpdate();
  }

  getCardSize(): number {
    return 12;
  }

  static getStubConfig(): HaNotificationsCardConfig {
    return { type: "custom:ha-notifications-card" };
  }
}

if (!customElements.get("ha-notifications-card")) {
  customElements.define("ha-notifications-card", HaNotificationsCard);
}

const customCardWindow = window as Window & {
  customCards?: Array<{
    type: string;
    name: string;
    description: string;
  }>;
};
customCardWindow.customCards = customCardWindow.customCards || [];
if (
  !customCardWindow.customCards.some(
    (card) => card.type === "ha-notifications-card",
  )
) {
  customCardWindow.customCards.push({
    type: "ha-notifications-card",
    name: "HA Notifications",
    description: "Manage HA Notifications alerts, history, and YAML.",
  });
}
