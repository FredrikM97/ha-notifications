import {
  deleteAlert,
  errorMessage,
  getAlerts,
  getAutomationStatus,
  getHistory,
  loadRegistries,
  saveAlert,
  triggerAlert,
  validateAlert,
} from "./api.js";
import { openEditor } from "./editor/index.js";
import { formatLocalDateTime } from "./date-time.js";
import { localize } from "./localize.js";
import { renderAlertCard } from "./panel/alert-card.js";
import "./history.js";
import type { HistoryFilters, HistoryRenderOptions } from "./history.js";
import { styles } from "./styles.js";
import { showToast as showToastOn, toastListTemplate } from "./toast.js";
import type { Toast } from "./toast.js";
import { LitElement, html } from "lit";
import type { TemplateResult } from "lit";
import type {
  Alert,
  AutomationRuntimeStatus,
  Hass,
  Registries,
  RuntimeAlertHistoryEntry,
} from "./types.js";
import "./yaml-view.js";

type PanelTab = "alerts" | "active" | "history" | "yaml";

interface PanelTabDefinition {
  key: PanelTab;
  label: string;
}

interface HaNotificationsCardConfig {
  type: "custom:ha-notifications-card";
}

const panelTabs: PanelTabDefinition[] = [
  { key: "alerts", label: "panel.tabs.alerts" },
  { key: "active", label: "panel.tabs.active" },
  { key: "history", label: "panel.tabs.history" },
  { key: "yaml", label: "panel.tabs.yaml" },
];

function activeTabClass(active: boolean): string {
  const classes = ["nc-tab"];
  if (active) {
    classes.push("active");
  }

  return classes.join(" ");
}

function toggleAlertToast(alert: Alert): string {
  if (alert.enabled) {
    return "Alert disabled.";
  }

  return "Alert enabled.";
}

class HaNotificationsPanel extends LitElement {
  private _hass: Hass | null = null;
  private alerts: Alert[] = [];
  private automationStatus: Record<string, AutomationRuntimeStatus> = {};
  private history: RuntimeAlertHistoryEntry[] = [];
  private historyAlertId: string | null = null;
  private historyAlertName: string | null = null;
  private historyFilters: HistoryFilters = {
    search: "",
    alertId: "",
    type: "",
    severity: "",
  };
  private historyGroupByFlow = false;
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
    const changed = this._hass !== null && this._hass !== value;
    this._hass = value;
    this.requestUpdate();

    if (this.isConnected && !this._initialized) {
      this._initialized = true;
      void this.refresh();
    } else if (this.isConnected && changed) {
      void this.refresh({ silent: true });
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
      const [alertsResult, automationStatusResult, historyResult] =
        await Promise.allSettled([
          getAlerts(this._hass),
          getAutomationStatus(this._hass),
          getHistory(this._hass, this.historyAlertId || undefined),
        ]);

      if (alertsResult.status === "fulfilled") {
        this.alerts = alertsResult.value;
        this.refreshHistoryAlertName();
      } else if (!silent) {
        this.showToast(errorMessage(alertsResult.reason), true);
      }

      if (historyResult.status === "fulfilled") {
        this.history = historyResult.value;
      } else if (!silent) {
        this.showToast(errorMessage(historyResult.reason), true);
      }
      if (automationStatusResult.status === "fulfilled") {
        this.automationStatus = automationStatusResult.value;
      } else if (!silent) {
        this.showToast(errorMessage(automationStatusResult.reason), true);
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
        <h2>${localize(this._hass, "panel.admin_required")}</h2>
        <p>
          ${localize(this._hass, "panel.admin_help")}
        </p>
      </div>
    </div>`;
  }

  private headerTemplate(): TemplateResult {
    return html`<div class="nc-header">
      <a
        class="nc-back-button"
        href="/"
        aria-label=${localize(this._hass, "panel.back_home")}
        title=${localize(this._hass, "panel.back_home")}
        @click=${this.navigateHome}
      >
        <ha-icon icon="mdi:arrow-left"></ha-icon>
      </a>
      <div class="nc-title">
        <div class="nc-title-icon">
          <img
            src="/ha_notifications/brand/icon.png"
            alt=""
            aria-hidden="true"
          />
        </div>
        <div>
          <h1>${localize(this._hass, "panel.title")}</h1>
          <p>${localize(this._hass, "panel.subtitle")}</p>
        </div>
      </div>
      <div class="nc-actions">
        <button class="nc-button" @click=${() => this.addAlert()}>
          + ${localize(this._hass, "panel.add_alert")}
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
            ${localize(this._hass, label)}
          </button>`,
      )}
    </div>`;
  }

  private tabTemplate(): TemplateResult {
    if (this.tab === "alerts") {
      return this.alertsTemplate();
    }

    if (this.tab === "active") {
      return this.activeTemplate();
    }

    if (this.tab === "history") {
      return html`<ha-notifications-history-view
        .history=${this.history}
        .options=${this.historyViewOptions()}
      ></ha-notifications-history-view>`;
    }

    return html`<ha-notifications-yaml-view
      .hass=${this._hass}
      .showToast=${(message: string, error?: boolean) =>
        this.showToast(message, error)}
      .refreshPanel=${() => this.refresh()}
    ></ha-notifications-yaml-view>`;
  }

  private alertsTemplate(): TemplateResult {
    return this.alertListTemplate(this.alerts, "panel.no_alerts", true);
  }

  private activeTemplate(): TemplateResult {
    const activeAlerts = this.alerts.filter((alert) => {
      const status = this.automationStatus[alert.id];
      return Boolean(status?.active_runs || status?.active_runs_uncertain);
    });
    return this.alertListTemplate(activeAlerts, "panel.no_active_alerts");
  }

  private alertListTemplate(
    alerts: Alert[],
    emptyTitle: string,
    showCreate = false,
  ): TemplateResult {
    if (alerts.length) {
      return html`<div class="nc-alerts">
        ${alerts.map((alert) =>
          renderAlertCard(alert, this._hass, {
            onTest: (item) => this.testAlert(item),
            onToggle: (item) => this.toggleAlert(item),
            onEdit: (item) => this.editAlert(item),
            onShowHistory: (item) => this.showAlertHistory(item),
            onDelete: (item) => this.removeAlert(item),
          }, this.automationStatus[alert.id]),
        )}
      </div>`;
    }

    return html`<div class="nc-card nc-empty">
      <h2>${localize(this._hass, emptyTitle)}</h2>
      ${showCreate
        ? html`<p>${localize(this._hass, "panel.create_first")}</p>
            <button class="nc-button" @click=${() => this.addAlert()}>
              ${localize(this._hass, "panel.create_alert")}
            </button>`
        : ""}
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
      groupByFlow: this.historyGroupByFlow,
      types: [
        ...new Set(this.history.map((item) => item.event?.type).filter(Boolean)),
      ] as string[],
      onFiltersChanged: (filters) => {
        this.historyFilters = filters;
        this.requestUpdate();
      },
      onGroupByFlowChanged: (groupByFlow) => {
        this.historyGroupByFlow = groupByFlow;
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

  private async testAlert(alert: Alert): Promise<void> {
    if (!this._hass) return;
    try {
      await triggerAlert(this._hass, alert.id);
      this.showToast(localize(this._hass, "panel.test_triggered"));
      await this.refresh({ silent: true });
    } catch (error) {
      this.showToast(errorMessage(error), true);
    }
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
      onValidateCondition: async (draft) => {
        await validateAlert(this._hass, draft);
        this.showToast(localize(this._hass, "panel.condition_valid"));
      },
      onSave: async (alert) => {
        const saved = await saveAlert(this._hass, alert);
        this.showToast(localize(this._hass, "panel.alert_created"));
        return saved;
      },
      onSaved: async () => {
        await this.refresh();
      },
      onClosed: () => {
        this.editorActive = false;
        void this.refresh();
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
      onValidateCondition: async (draft) => {
        await validateAlert(this._hass, draft);
        this.showToast(localize(this._hass, "panel.condition_valid"));
      },
      onSave: async (updated) => {
        const saved = await saveAlert(this._hass, updated);
        this.replaceSavedAlert(saved);
        this.showToast(localize(this._hass, "panel.alert_saved"));
        return saved;
      },
      onSaved: async () => {
        await this.refresh();
      },
      onClosed: () => {
        this.editorActive = false;
        void this.refresh();
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
        };
      }

      return item;
    });
    this.requestUpdate();
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
    this.history = [];
    await this.refresh();
    this.requestUpdate();
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
    this.history = [];
    await this.refresh();
    this.requestUpdate();
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
      this.showToast(localize(this._hass, "panel.alert_deleted"));
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
