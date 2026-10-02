import {
  cancelRun,
  deleteAlert,
  errorMessage,
  getAlerts,
  getAutomationStatus,
  getHistory,
  loadRegistries,
  saveAlert,
  validateAlert,
} from "./api.js";
import { openEditor, updateOpenEditorHass } from "./editor/index.js";
import { formatLocalDateTime } from "./date-time.js";
import { localize } from "./localize.js";
import "./panel/alert-list.js";
import "./history.js";
import type { HistoryFilters, HistoryRenderOptions } from "./history.js";
import { css, LitElement, html } from "lit";
import { button, buttonStyles } from "./components/button.js";
import type {
  AlertActionItem,
  AlertActionRequest,
} from "./panel/alert-card/actions.js";
import { showToast as showToastOn, toastListTemplate } from "./components/toast.js";
import type { Toast } from "./components/toast.js";
import type { YamlToastEventDetail } from "./components/yaml-view.js";
import type { TemplateResult } from "lit";
import type {
  Alert,
  AutomationRuntimeStatus,
  Hass,
  Registries,
  RuntimeAlertHistoryEntry,
} from "./types.js";
import "./components/yaml-view.js";

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

export const panelStyles = css`
  :host {
    display: block;
    min-height: 100%;
    box-sizing: border-box;
    color: var(--primary-text-color);
    background: var(--primary-background-color);
  }

  :host(ha-notifications-card) {
    container-type: inline-size;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  [hidden] {
    display: none !important;
  }

  button,
  input,
  textarea,
  select {
    font: inherit;
  }

  .nc-empty {
    padding: 55px 20px;
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow);
    color: var(--secondary-text-color);
    text-align: center;
  }

  .nc-empty h2 {
    color: var(--primary-text-color);
  }

  .nc-page {
    max-width: 1400px;
    margin: 0 auto;
    padding: 24px;
  }

  .nc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  }

  .nc-back-button {
    display: none;
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    place-items: center;
    border-radius: 50%;
    color: var(--primary-text-color);
    background: var(--secondary-background-color);
    text-decoration: none;
  }

  .nc-back-button:hover {
    background: var(--divider-color);
  }

  :host(ha-notifications-card) .nc-back-button {
    display: none;
  }

  .nc-title {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .nc-title-icon {
    display: grid;
    width: 48px;
    height: 48px;
    place-items: center;
    border-radius: 14px;
    background: var(--primary-color);
    color: var(--text-primary-color);
    font-size: 24px;
  }

  .nc-title-icon img {
    width: 32px;
    height: 32px;
    object-fit: contain;
  }

  .nc-title h1 {
    margin: 0;
    font-size: 28px;
  }

  .nc-title p {
    margin: 4px 0 0;
    color: var(--secondary-text-color);
  }

  .nc-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .nc-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 18px;
    padding: 4px;
    border-radius: var(--ha-border-radius-m, 8px);
    background: var(--secondary-background-color);
  }

  .nc-tab {
    flex: 1;
    border: 0;
    border-radius: var(--ha-border-radius-s, 4px);
    padding: 8px 10px;
    background: transparent;
    color: var(--secondary-text-color);
    cursor: pointer;
    font-weight: 600;
  }

  .nc-tab.active {
    background: var(--card-background-color);
    color: var(--primary-text-color);
    box-shadow: var(--ha-box-shadow);
  }

  @container (max-width: 700px) {
    .nc-page {
      padding: 14px;
    }

    .nc-header {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 10px;
    }

    .nc-back-button {
      display: inline-grid;
      grid-column: 1;
      grid-row: 2;
    }

    .nc-title {
      grid-column: 1 / -1;
      grid-row: 1;
      min-width: 0;
      justify-self: start;
    }

    .nc-title h1 {
      font-size: 24px;
    }

    .nc-actions {
      grid-column: 1 / -1;
      grid-row: 2;
      justify-content: flex-end;
      width: 100%;
    }
  }

  @media (max-width: 700px) {
    :host(ha-notifications-panel) .nc-page.nc-mobile-full-page {
      min-height: 100dvh;
      padding: 0;
    }

    .nc-page {
      padding: 14px;
    }

    .nc-header {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 10px;
    }

    .nc-back-button {
      display: inline-grid;
      grid-column: 1;
      grid-row: 2;
    }

    .nc-title {
      grid-column: 1 / -1;
      grid-row: 1;
      min-width: 0;
      justify-self: start;
    }

    .nc-title h1 {
      font-size: 24px;
    }

    .nc-actions {
      grid-column: 1 / -1;
      grid-row: 2;
      justify-content: flex-end;
      width: 100%;
    }
  }
`;

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
  static styles = [buttonStyles, panelStyles];

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
  private readonly alertActionHandlers: Record<
    string,
    (alert?: Alert) => void
  > = {
    create: () => {
      void this.addAlert();
    },
    toggle: (alert) => {
      if (alert) void this.toggleAlert(alert);
    },
    edit: (alert) => {
      if (alert) void this.editAlert(alert);
    },
    history: (alert) => {
      if (alert) void this.showAlertHistory(alert);
    },
    delete: (alert) => {
      if (alert) void this.removeAlert(alert);
    },
    cancel_run: (alert) => {
      if (alert) void this.cancelAlertRun(alert);
    },
  };

  set hass(value: Hass) {
    const changed = this._hass !== null && this._hass !== value;
    this._hass = value;
    if (this.editorActive) {
      updateOpenEditorHass(this.renderRoot as ShadowRoot, value);
    }
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
      return html`${this.adminRequiredTemplate()}${toastListTemplate(this.toasts)}`;
    }

    return html`<div
      class=${this.tab === "history" ? "nc-page nc-mobile-full-page" : "nc-page"}
      ?hidden=${this.editorActive}
    >
        ${this.headerTemplate()}${this.tabsTemplate()}${this.tabTemplate()}
      </div>
      ${toastListTemplate(this.toasts)}`;
  }

  private adminRequiredTemplate(): TemplateResult {
    return html`<div class="nc-page">
      <div class="nc-empty">
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
        ${button({
          label: localize(this._hass, "panel.add_alert"),
          icon: "mdi:plus",
          onClick: () => this.addAlert(),
        })}
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
    if (this.tab === "alerts" || this.tab === "active") {
      return html`<ha-notifications-alert-list
        .alerts=${this.alerts}
        .automationStatus=${this.automationStatus}
        .hass=${this._hass}
        .activeOnly=${this.tab === "active"}
        .actionItems=${this.alertActionItems}
        .emptyAction=${{
          id: "create",
          label: localize(this._hass, "panel.create_alert"),
        }}
        @alert-action=${this.handleAlertAction}
      ></ha-notifications-alert-list>`;
    }

    if (this.tab === "history") {
      return html`<ha-notifications-history-view
        .history=${this.history}
        .options=${this.historyViewOptions()}
        @history-filters-changed=${this.handleHistoryFiltersChanged}
        @history-group-by-flow-changed=${this.handleHistoryGroupingChanged}
        @history-alert-selected=${this.handleHistoryAlertSelected}
        @history-show-all=${this.handleHistoryShowAll}
      ></ha-notifications-history-view>`;
    }

    return html`<ha-notifications-yaml-view
      .hass=${this._hass}
      @yaml-toast=${this.handleYamlToast}
      @yaml-refresh-requested=${this.handleYamlRefreshRequested}
    ></ha-notifications-yaml-view>`;
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
    };
  }

  private selectTab(tab: PanelTab): void {
    this.tab = tab;
    this.requestUpdate();
  }

  private handleAlertAction = (event: CustomEvent<AlertActionRequest>): void => {
    this.alertActionHandlers[event.detail.actionId]?.(event.detail.alert);
  };

  private alertActionItems = (
    alert: Alert,
    status: AutomationRuntimeStatus | undefined,
  ): AlertActionItem[] => {
    const actions: AlertActionItem[] = [
      {
        id: "toggle",
        label: localize(this._hass, alert.enabled ? "alert.disable" : "alert.enable"),
        icon: alert.enabled
          ? "mdi:pause-circle-outline"
          : "mdi:play-circle-outline",
      },
      {
        id: "edit",
        label: localize(this._hass, "alert.edit"),
        icon: "mdi:pencil-outline",
      },
      {
        id: "history",
        label: localize(this._hass, "alert.history"),
        icon: "mdi:history",
      },
      {
        id: "delete",
        label: localize(this._hass, "alert.delete"),
        icon: "mdi:delete-outline",
        variant: "danger",
      },
    ];

    if (status?.automation_id) {
      actions.unshift({
        id: "automation",
        label: localize(this._hass, "alert.open_automation"),
        icon: "mdi:open-in-new",
        className: "nc-open-automation",
        href: `/config/automation/edit/${encodeURIComponent(status.automation_id)}`,
      });
    }
    if (status?.current > 0) {
      actions.unshift({
        id: "cancel_run",
        label: localize(this._hass, "alert.cancel_run"),
        icon: "mdi:stop-circle-outline",
        variant: "danger",
      });
    }
    return actions;
  };

  private handleHistoryFiltersChanged = (
    event: CustomEvent<HistoryFilters>,
  ): void => {
    this.historyFilters = event.detail;
    this.requestUpdate();
  };

  private handleHistoryGroupingChanged = (
    event: CustomEvent<boolean>,
  ): void => {
    this.historyGroupByFlow = event.detail;
    this.requestUpdate();
  };

  private handleHistoryAlertSelected = (
    event: CustomEvent<{ alertId: string; alertName: string }>,
  ): void => {
    void this.showHistoryForAlert(event.detail.alertId, event.detail.alertName);
  };

  private handleHistoryShowAll = (): void => {
    void this.showAllHistory();
  };

  private handleYamlToast = (
    event: CustomEvent<YamlToastEventDetail>,
  ): void => {
    this.showToast(event.detail.message, event.detail.error);
  };

  private handleYamlRefreshRequested = (): void => {
    void this.refresh();
  };

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
    await this.openAlertEditor(null);
  };

  async editAlert(alert: Alert): Promise<void> {
    await this.openAlertEditor(alert);
  }

  private async openAlertEditor(alert: Alert | null): Promise<void> {
    let registries: Registries;
    try {
      registries = await this.getRegistries();
    } catch (err) {
      this.showToast(errorMessage(err), true);
      return;
    }

    this.editorActive = true;
    this.requestUpdate();
    const hass = this._hass;
    if (!hass) {
      this.editorActive = false;
      return;
    }
    openEditor({
      root: this.renderRoot as ShadowRoot,
      hass,
      alert,
      registries,
      onValidateAlert: async (draft) => {
        await validateAlert(this._hass, draft);
      },
      onSave: async (draft) => {
        const saved = await saveAlert(this._hass, draft);
        if (alert) {
          this.replaceSavedAlert(saved);
        }
        this.showToast(
          localize(this._hass, alert ? "panel.alert_saved" : "panel.alert_created"),
        );
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

  private async cancelAlertRun(alert: Alert): Promise<void> {
    try {
      const result = await cancelRun(this._hass, alert.id);
      this.showToast(
        localize(
          this._hass,
          result.cancelled ? "alert.run_cancelled" : "alert.run_not_active",
        ),
      );
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
