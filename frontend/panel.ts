import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { mdiPlus } from "@mdi/js";
import { errorMessage, request } from "./api.js";
import type { Alert, AlertsConfig, AutomationRuntimeStatus, Hass, RuntimeAlertHistoryEntry } from "./types.js";
import { localize } from "./localize.js";
import { emptyState, NarrowController, notify, uiStyles } from "./ui.js";
import { openEditor, updateOpenEditorHass } from "./editor/index.js";
import { toCanonicalAlert, type EditableAlert } from "./editor/alert-model.js";
import { alertList, alertListStyles, type AlertHandlers } from "./views/alerts.js";
import "./views/history.js";
import "./views/yaml.js";

const TABS = ["alerts", "active", "history", "yaml"] as const;
type Tab = (typeof TABS)[number];
const AUTO_REFRESH_MS = 5000;

const panelStyles = css`
  /* Full width like HA's own dashboards and config lists. */
  .nc-content {
    padding: var(--ha-space-4, 16px);
  }

  .nc-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--ha-space-4, 16px) var(--ha-space-4, 16px) 0;
  }

  .nc-card-header h1 {
    margin: 0;
    font-size: var(--ha-font-size-xl, 20px);
  }

  [hidden] {
    display: none !important;
  }
`;

class HaNotificationsPanel extends LitElement {
  static styles = [uiStyles, alertListStyles, panelStyles];

  private layout = new NarrowController(this);
  private _hass: Hass | null = null;
  private tab: Tab = "alerts";
  private alerts: Alert[] = [];
  private statuses: Record<string, AutomationRuntimeStatus> = {};
  private history: RuntimeAlertHistoryEntry[] = [];
  private historyAlert: { id: string; name: string } | null = null;
  private editing = false;
  private refreshing = false;
  private timer?: number;
  private users?: Promise<{ value: string; label: string }[]>;

  /** The Lovelace card renders without the full-page app bar. */
  protected get isCard(): boolean {
    return false;
  }

  set hass(hass: Hass) {
    const first = !this._hass;
    this._hass = hass;
    if (this.editing) updateOpenEditorHass(this.renderRoot as ShadowRoot, hass);
    this.requestUpdate();
    if (this.isConnected) void this.refresh(!first);
  }

  get hass(): Hass {
    return this._hass!;
  }

  connectedCallback(): void {
    // HA may set hass before this module loads; that own property shadows the setter.
    if (Object.prototype.hasOwnProperty.call(this, "hass")) {
      const hass = (this as { hass?: Hass }).hass;
      delete (this as { hass?: Hass }).hass;
      if (hass) this._hass = hass;
    }
    super.connectedCallback();
    this.timer = window.setInterval(() => void this.refresh(true), AUTO_REFRESH_MS);
    if (this._hass) void this.refresh();
  }

  disconnectedCallback(): void {
    window.clearInterval(this.timer);
    super.disconnectedCallback();
  }

  private t = (key: string, variables?: Record<string, unknown>) => localize(this._hass, key, variables);

  async refresh(silent = false): Promise<void> {
    if (!this._hass?.user?.is_admin || this.refreshing) return;
    if (silent && (this.editing || this.tab === "yaml")) return;
    this.refreshing = true;
    const results = await Promise.allSettled([
      this.loadAlerts(),
      request<Record<string, AutomationRuntimeStatus>>(this._hass, "automation_status"),
      request<RuntimeAlertHistoryEntry[]>(this._hass, "get_history", {
        ...(this.historyAlert?.id ? { alert_id: this.historyAlert.id } : {}),
      }),
    ]);
    this.refreshing = false;
    const [alerts, statuses, history] = results;
    if (alerts.status === "fulfilled") this.alerts = alerts.value;
    if (statuses.status === "fulfilled") this.statuses = statuses.value;
    if (history.status === "fulfilled") this.history = history.value;
    if (this.historyAlert) {
      const alert = this.alerts.find(({ id }) => id === this.historyAlert!.id);
      if (alert) this.historyAlert = { id: alert.id, name: alert.name };
    }
    if (!silent) {
      for (const result of results) {
        if (result.status === "rejected") notify(this, errorMessage(result.reason));
      }
    }
    this.requestUpdate();
  }

  protected render(): TemplateResult {
    if (!this._hass?.user?.is_admin) {
      return emptyState(this.t("panel.admin_required"), this.t("panel.admin_help"));
    }
    const narrow = this.layout.narrow;
    const add = html`<ha-icon-button
      .label=${this.t("panel.add_alert")}
      .path=${mdiPlus}
      @click=${this.on.create}
    ></ha-icon-button>`;
    const tabs = html`<ha-tab-group
      @wa-tab-show=${(event: CustomEvent<{ name: Tab }>) => this.selectTab(event.detail.name)}
    >
      ${TABS.map(
        (tab) => html`<ha-tab-group-tab slot="nav" panel=${tab} .active=${tab === this.tab}>
          ${this.t(`panel.tabs.${tab}`)}
        </ha-tab-group-tab>`,
      )}
    </ha-tab-group>`;
    const content = html`<div class="nc-content">${this.tabContent()}</div>`;

    if (this.isCard) {
      return html`<ha-card ?hidden=${this.editing}>
        <div class="nc-card-header"><h1>${this.t("panel.title")}</h1>${add}</div>
        ${tabs}${content}
      </ha-card>`;
    }
    return html`<ha-top-app-bar-fixed .narrow=${narrow} ?hidden=${this.editing}>
      <div slot="title">${this.t("panel.title")}</div>
      <div slot="actionItems">${add}</div>
      <div slot="subRow">${tabs}</div>
      ${content}
    </ha-top-app-bar-fixed>`;
  }

  private tabContent(): TemplateResult | typeof nothing {
    switch (this.tab) {
      case "alerts":
      case "active":
        return alertList(this._hass, this.alerts, this.statuses, this.tab === "active", this.on, this.layout.narrow);
      case "history":
        return html`<ha-notifications-history-view
          .hass=${this._hass}
          .history=${this.history}
          .alerts=${this.alerts}
          .alertName=${this.historyAlert?.name ?? null}
          @history-alert-selected=${(event: CustomEvent<{ alertId: string; alertName: string }>) =>
            this.showHistory({ id: event.detail.alertId, name: event.detail.alertName })}
          @history-show-all=${() => this.showHistory(null)}
        ></ha-notifications-history-view>`;
      case "yaml":
        return html`<ha-notifications-yaml-view
          .hass=${this._hass}
          @yaml-saved=${() => void this.refresh()}
        ></ha-notifications-yaml-view>`;
    }
  }

  private selectTab(tab: Tab): void {
    if (this.tab === tab) return;
    const yaml = this.renderRoot.querySelector<HTMLElement & { confirmLeave(): boolean }>(
      "ha-notifications-yaml-view",
    );
    if (yaml && !yaml.confirmLeave()) {
      this.requestUpdate();
      return;
    }
    this.tab = tab;
    this.requestUpdate();
  }

  private async showHistory(alert: { id: string; name: string } | null): Promise<void> {
    this.historyAlert = alert;
    this.history = [];
    this.selectTab("history");
    await this.refresh();
  }

  private async loadAlerts(): Promise<Alert[]> {
    const config = await request(this._hass, "get_config");
    if (!config || typeof config !== "object" || Array.isArray(config)
      || !Array.isArray((config as { alerts?: unknown }).alerts)) {
      throw new Error("ha_notifications/get_config: expected canonical configuration with an alerts array.");
    }
    return (config as { alerts: Alert[] }).alerts;
  }

  private async configWithAlert(alert: Alert): Promise<AlertsConfig> {
    const config = await request<AlertsConfig>(this._hass, "get_config");
    const canonical = toCanonicalAlert(alert);
    if (config.alerts.some(({ id }) => id === alert.id)) {
      return { ...config, alerts: config.alerts.map((existing) => existing.id === alert.id ? canonical : existing) };
    }
    return { ...config, alerts: [...config.alerts, canonical] };
  }

  private async saveAlert(alert: Alert): Promise<Alert> {
    if (!alert.id || typeof alert.id !== "string") {
      throw new Error("ha_notifications/save_config: alert.id is required.");
    }
    const config = await this.configWithAlert(alert);
    const result = await request<{ saved: boolean; config: AlertsConfig }>(this._hass, "save_config", { config });
    const saved = result.config.alerts.find(({ id }) => id === alert.id);
    if (!saved) {
      throw new Error(`ha_notifications/save_config: saved alert ${alert.id} was not returned.`);
    }
    return saved as Alert;
  }

  private async deleteAlert(alertId: string): Promise<unknown> {
    const config = await request<AlertsConfig>(this._hass, "get_config");
    if (!config.alerts.some(({ id }) => id === alertId)) {
      throw new Error(`ha_notifications/save_config: alert ${alertId} was not found.`);
    }
    return request(this._hass, "save_config", {
      config: { ...config, alerts: config.alerts.filter(({ id }) => id !== alertId) },
    });
  }

  private async loadUsers(): Promise<{ value: string; label: string }[]> {
    const users = await request<{
      id: string; name: string; is_active?: boolean; system_generated?: boolean;
    }[]>(this._hass, "config/auth/list");
    return users
      .filter((user) => user.is_active !== false && !user.system_generated)
      .map((user) => ({ value: user.id, label: user.name }));
  }

  /** Run an API call, report its outcome, and refresh. */
  private async act(call: () => Promise<unknown>, success?: string): Promise<void> {
    try {
      const message = await call();
      const text = typeof message === "string" ? message : success;
      if (text) notify(this, text);
      await this.refresh();
    } catch (error) {
      notify(this, errorMessage(error));
    }
  }

  private on: AlertHandlers = {
    create: () => void this.openAlertEditor(null),
    edit: (alert) => void this.openAlertEditor(alert),
    history: (alert) => void this.showHistory({ id: alert.id, name: alert.name }),
    navigate: (path) => {
      window.history.pushState({ from: window.location.pathname + window.location.search }, "", path);
      window.dispatchEvent(new CustomEvent("location-changed", {
        detail: { replace: false }, bubbles: true, composed: true,
      }));
    },
    toggle: (alert) =>
      void this.act(
        () => this.saveAlert({ ...alert, enabled: !alert.enabled }),
        alert.enabled ? "Alert disabled." : "Alert enabled.",
      ),
    cancelRun: (alert) =>
      void this.act(async () => {
        const result = await request<{ cancelled: boolean }>(this._hass, "cancel_run", { alert_id: alert.id });
        return this.t(result.cancelled ? "alert.run_cancelled" : "alert.run_not_active");
      }),
    testAlert: (alert) => {
      if (!window.confirm(this.t("alert.confirm_test", { name: alert.name }))) return;
      void this.act(() => request(this._hass, "test_alert", { alert_id: alert.id }), this.t("alert.test_started"));
    },
    remove: (alert) => {
      if (!window.confirm(`Delete "${alert.name}"?`)) return;
      void this.act(() => this.deleteAlert(alert.id), this.t("panel.alert_deleted"));
    },
  };

  private async openAlertEditor(alert: Alert | null): Promise<void> {
    const hass = this._hass;
    if (!hass) return;
    let users: { value: string; label: string }[];
    let defaults: EditableAlert;
    try {
      this.users ??= this.loadUsers();
      [users, defaults] = await Promise.all([
        this.users,
        request<EditableAlert>(hass, "alert_defaults"),
      ]);
    } catch (error) {
      this.users = undefined;
      notify(this, errorMessage(error));
      return;
    }
    this.editing = true;
    this.requestUpdate();
    openEditor({
      root: this.renderRoot as ShadowRoot,
      hass,
      alert,
      defaults,
      users,
      onValidateAlert: async (draft) => request(this._hass, "validate_config", {
        config: await this.configWithAlert(draft),
      }),
      onSave: async (draft) => {
        const saved = await this.saveAlert(draft);
        notify(this, this.t(alert ? "panel.alert_saved" : "panel.alert_created"));
        return saved;
      },
      onClosed: () => {
        this.editing = false;
        void this.refresh();
      },
    });
  }
}

if (!customElements.get("ha-notifications-panel")) {
  customElements.define("ha-notifications-panel", HaNotificationsPanel);
}

interface CardConfig {
  type: "custom:ha-notifications-card";
}

class HaNotificationsCard extends HaNotificationsPanel {
  protected get isCard(): boolean {
    return true;
  }

  setConfig(config: CardConfig): void {
    if (config?.type !== "custom:ha-notifications-card") {
      throw new Error("Card type must be custom:ha-notifications-card.");
    }
  }

  getCardSize(): number {
    return 12;
  }

  static getStubConfig(): CardConfig {
    return { type: "custom:ha-notifications-card" };
  }
}

if (!customElements.get("ha-notifications-card")) {
  customElements.define("ha-notifications-card", HaNotificationsCard);
}

const cards = ((window as { customCards?: { type: string }[] }).customCards ??= []);
if (!cards.some(({ type }) => type === "ha-notifications-card")) {
  cards.push({
    type: "ha-notifications-card",
    name: "HA Notifications",
    description: "Manage HA Notifications alerts, history, and YAML.",
  } as { type: string });
}
