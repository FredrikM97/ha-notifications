import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { mdiFilterRemoveOutline, mdiFilterVariant, mdiFormatListBulleted, mdiFormatListGroup } from "@mdi/js";
import type { Hass, HassLocale, RuntimeAlertHistoryEntry } from "../types.js";
import { localize } from "../localize.js";
import { emptyState, haButton, NarrowController, selectConfig, toolbar, uiStyles, type SelectOption } from "../ui.js";

const styles = css`
  :host {
    container-type: inline-size;
  }

  .nc-list {
    padding: 0 var(--ha-space-4, 16px) var(--ha-space-2, 8px);
  }

  .nc-muted {
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
  }

  .nc-flow > summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ha-space-3, 12px);
    padding: var(--ha-space-3, 12px) 0 var(--ha-space-1, 4px);
    color: var(--secondary-text-color);
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .nc-flow > summary span:last-child {
    margin-left: auto;
  }

  /* Two-line logbook rows: what happened, then when and why. */
  .nc-item {
    display: grid;
    gap: 2px;
    padding: var(--ha-space-3, 12px) 0;
    border-bottom: 1px solid var(--divider-color);
    overflow-wrap: anywhere;
  }

  .nc-item-title {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ha-space-2, 8px);
    min-width: 0;
    font-weight: var(--ha-font-weight-medium, 500);
  }

  .nc-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ha-space-2, 8px);
    padding: var(--ha-space-2, 8px) var(--ha-space-4, 16px) 0;
  }

  .nc-link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--primary-color);
    cursor: pointer;
    font-weight: inherit;
  }

  .nc-badge {
    border-radius: 999px;
    padding: 2px 7px;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  }

  .nc-badge.error {
    background: color-mix(in srgb, var(--error-color) 14%, var(--card-background-color));
    color: var(--error-color);
  }

  .nc-badge.success {
    background: color-mix(in srgb, var(--success-color) 14%, var(--card-background-color));
    color: var(--success-color);
  }

  .nc-badge.info {
    background: color-mix(in srgb, var(--info-color) 12%, var(--card-background-color));
    color: var(--info-color);
  }

  .nc-badge.muted {
    background: var(--secondary-background-color);
    color: var(--secondary-text-color);
  }

  .nc-flow-id {
    border: 1px solid var(--divider-color);
    border-radius: 999px;
    padding: 2px 7px;
    color: var(--secondary-text-color);
    font: 11px monospace;
  }

  .nc-item details {
    color: var(--secondary-text-color);
    font-size: 12px;
  }

  .nc-item summary {
    cursor: pointer;
  }

  .nc-item pre {
    margin: 6px 0 0;
    padding: var(--ha-space-2, 8px);
    border-radius: 6px;
    background: var(--secondary-background-color);
    white-space: pre-wrap;
  }

  .nc-empty-list {
    padding: var(--ha-space-4, 16px) 0;
    color: var(--secondary-text-color);
  }

`;

// ---- Pure helpers (no DOM; unit-testable) ----
export function emptyHistoryFilters(): HistoryFilters {
  return { search: "", alertId: "", type: "", severity: "" };
}

export interface HistoryFilters {
  search: string;
  alertId: string;
  type: string;
  severity: string;
}

export interface HistoryFlowGroup {
  flowId?: string;
  entries: RuntimeAlertHistoryEntry[];
}

export function historySeverity(type: string | undefined): string {
  if (!type) return "info";
  if (type.includes("failed") || type.includes("error")) return "error";
  if (type.includes("confirmed") || type.includes("sent")) return "success";
  if (type.includes("inactive")) return "muted";
  return "info";
}

export function formatType(value: string | undefined): string {
  return String(value || "event").replaceAll("_", " ");
}

export function shortFlowId(value: string | undefined): string {
  if (!value) return "";
  if (value.length > 18) return value.slice(-12);
  return value;
}

export function historyStartedBySummary(
  details: Record<string, unknown> | undefined,
): string {
  const origin = details?.started_by;
  if (!origin || typeof origin !== "object" || Array.isArray(origin)) return "";

  const trigger = origin as Record<string, unknown>;
  const entityId = stringValue(trigger.entity_id);
  const fromState = stringValue(trigger.from_state);
  const toState = stringValue(trigger.to_state);
  if (entityId) {
    if (fromState || toState) {
      return `${entityId} (${fromState || "?"} -> ${toState || "?"})`;
    }
    return entityId;
  }

  const platform = stringValue(trigger.platform);
  const eventType = stringValue(trigger.event_type);
  if (eventType) return platform ? `${platform} event ${eventType}` : eventType;

  const description = stringValue(trigger.description);
  if (description) return description;

  const triggerId = stringValue(trigger.id);
  if (triggerId) return platform ? `${platform} trigger ${triggerId}` : `trigger ${triggerId}`;
  return platform ? `${platform} trigger` : "";
}

export function historyDetailSummary(
  details: Record<string, unknown> | undefined,
): string {
  if (!details || !Object.keys(details).length) return "";
  if (typeof details.error === "string") return details.error;
  if (typeof details.source === "string") return `Source: ${details.source}`;
  const startedBy = historyStartedBySummary(details);
  if (startedBy) return `Started by ${startedBy}`;
  if (Object.keys(details).every((key) => key === "attempt")) return "";
  return JSON.stringify(details);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function filterHistoryEntries(
  history: RuntimeAlertHistoryEntry[],
  filters: HistoryFilters,
): RuntimeAlertHistoryEntry[] {
  const search = filters.search.trim().toLowerCase();

  return history.filter((item) => {
    if (filters.alertId && item.config?.id !== filters.alertId) return false;
    if (filters.type && item.event?.type !== filters.type) return false;
    if (
      filters.severity &&
      historySeverity(item.event?.type) !== filters.severity
    ) {
      return false;
    }
    if (!search) return true;

    const searchable = [
      item.config?.name,
      item.event?.message,
      item.event?.type,
      item.event?.flow_id,
      historyDetailSummary(item.event?.details),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes(search);
  });
}

export function groupHistoryEntries(
  history: RuntimeAlertHistoryEntry[],
): HistoryFlowGroup[] {
  const groups: HistoryFlowGroup[] = [];
  const byFlow = new Map<string, HistoryFlowGroup>();

  for (const entry of history) {
    const flowId = entry.event?.flow_id;
    if (!flowId) {
      groups.push({ entries: [entry] });
      continue;
    }

    let group = byFlow.get(flowId);
    if (!group) {
      group = { flowId, entries: [] };
      byFlow.set(flowId, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }

  return groups;
}

export function formatLocalDateTime(
  value: string | undefined,
  includeSeconds = false,
  locale?: HassLocale,
): string {
  if (!value) {
    return "—";
  }

  try {
    const date = new Date(value);
    const dateLocale =
      locale?.date_format === "system" ? undefined : locale?.language;
    const timeLocale =
      locale?.time_format === "system" ? undefined : locale?.language;
    let hour12: boolean | undefined;
    if (locale?.time_format === "12") {
      hour12 = true;
    } else if (locale?.time_format === "24") {
      hour12 = false;
    }

    const dateFormatter = new Intl.DateTimeFormat(dateLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const datePart = formatDatePart(dateFormatter, date, locale?.date_format);
    const timePart = new Intl.DateTimeFormat(timeLocale, {
      hour: "numeric",
      minute: "2-digit",
      hour12,
      ...(includeSeconds ? { second: "2-digit" } : {}),
    }).format(date);
    return `${datePart}, ${timePart}`;
  } catch (_err) {
    return value;
  }
}

function formatDatePart(
  formatter: Intl.DateTimeFormat,
  date: Date,
  format: string | undefined,
): string {
  const order = {
    DMY: ["day", "month", "year"],
    MDY: ["month", "day", "year"],
    YMD: ["year", "month", "day"],
  }[format || ""];
  if (!order) {
    return formatter.format(date);
  }

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return order.map((part) => parts[part]).join("/");
}

// ---- View ----

export interface HistoryAlertOption {
  id: string;
  name: string;
}

type Entry = RuntimeAlertHistoryEntry;
type SelectFilter = "alertId" | "type" | "severity";

const SEVERITIES = ["error", "success", "info", "muted"];
const VIEW_SETTINGS_KEY = "ha_notifications.history_view";

function savedViewSettings(): { groupByFlow?: boolean; showFilters?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(VIEW_SETTINGS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

class HistoryView extends LitElement {
  static properties = {
    hass: { attribute: false },
    history: { attribute: false },
    alerts: { attribute: false },
    alertName: { attribute: false },
  };

  static styles = [uiStyles, styles];

  declare hass: Hass | undefined;
  declare history: Entry[];
  declare alerts: HistoryAlertOption[];
  /** Set when the view is focused on one alert. */
  declare alertName: string | null;

  private layout = new NarrowController(this);
  private filters = emptyHistoryFilters();
  private groupByFlow = Boolean(savedViewSettings().groupByFlow);
  private showFilters = Boolean(savedViewSettings().showFilters);

  constructor() {
    super();
    this.history = [];
    this.alerts = [];
    this.alertName = null;
  }

  protected willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("alertName")) this.filters = emptyHistoryFilters();
  }

  private t = (key: string, variables?: Record<string, unknown>, fallback?: string) =>
    localize(this.hass, key, variables, fallback);

  protected render(): TemplateResult {
    if (!this.history.length) {
      return emptyState(
        this.alertName
          ? this.t("history.no_activity_for", { name: this.alertName })
          : this.t("history.no_activity"),
        this.t("history.activity_help"),
        this.alertName ? { label: this.t("history.show_all"), run: this.showAll } : undefined,
      );
    }

    const entries = filterHistoryEntries(this.history, this.filters);
    return html`<ha-card>
      ${this.toolbar()}
      ${this.filterArea()}
      <div class="nc-list">
      ${this.historyItems(entries)}
      ${entries.length && entries.length !== this.history.length
        ? html`<div class="nc-muted">
            ${this.t("history.showing", { count: entries.length, total: this.history.length })}
          </div>`
        : nothing}
      </div>
    </ha-card>`;
  }

  private filterArea(): TemplateResult | typeof nothing {
    if (this.alertName) return nothing;
    return this.showFilters ? this.filterControls() : this.chips();
  }

  private historyItems(entries: Entry[]): TemplateResult | TemplateResult[] {
    if (!entries.length) {
      return html`<div class="nc-empty-list">${this.t("history.no_matches")}</div>`;
    }
    if (this.groupByFlow) {
      return groupHistoryEntries(entries).map((group) =>
        group.flowId ? this.flow(group.flowId, group.entries) : this.item(group.entries[0]),
      );
    }
    return entries.map((entry) => this.item(entry));
  }

  private toolbar(): TemplateResult {
    const narrow = this.layout.narrow;
    if (this.alertName) {
      return toolbar(
        html`<strong>${this.t("history.for_alert", { name: this.alertName })}</strong>`,
        [],
        narrow,
        haButton(this.t("panel.show_all"), this.showAll, { appearance: "filled", variant: "neutral" }),
      );
    }
    const { search, ...selects } = this.filters;
    const active = Object.values(selects).filter(Boolean).length;
    return toolbar(
      html`<ha-input
        type="search"
        .label=${this.t("history.search")}
        .value=${search}
        @input=${(event: Event) => this.setFilter("search", (event.currentTarget as HTMLInputElement).value)}
      ></ha-input>`,
      [
        {
          label: active ? `${this.t("history.more_filters")} (${active})` : this.t("history.more_filters"),
          path: mdiFilterVariant,
          action: () => this.set(() => (this.showFilters = !this.showFilters)),
        },
        {
          label: this.t("history.group_by_flow"),
          path: this.groupByFlow ? mdiFormatListGroup : mdiFormatListBulleted,
          action: () => this.set(() => (this.groupByFlow = !this.groupByFlow)),
        },
        ...(active || search
          ? [{
              label: this.t("history.clear"),
              path: mdiFilterRemoveOutline,
              action: () => this.set(() => (this.filters = emptyHistoryFilters())),
            }]
          : []),
      ],
      narrow,
    );
  }

  private filterControls(): TemplateResult {
    const types = [...new Set(this.history.map((entry) => entry.event?.type).filter(Boolean))] as string[];
    const select = (key: SelectFilter, label: string, all: string, options: SelectOption[]) =>
      html`<ha-selector
        .hass=${this.hass}
        .selector=${selectConfig(`history-${key}`, [{ value: "", label: this.t(all) }, ...options])}
        .value=${this.filters[key]}
        .required=${false}
        .label=${this.t(label)}
        @value-changed=${(event: CustomEvent<{ value?: string }>) => this.setFilter(key, event.detail.value || "")}
      ></ha-selector>`;

    return html`<div class="nc-filters">
      ${this.alerts.length
        ? select(
            "alertId",
            "history.alert",
            "history.all_alerts",
            this.alerts.map(({ id, name }) => ({ value: id, label: name })),
          )
        : nothing}
      ${select(
        "type",
        "history.event_type",
        "history.all_event_types",
        types.map((type) => ({ value: type, label: this.t(`event.${type}`, {}, formatType(type)) })),
      )}
      ${select(
        "severity",
        "history.severity",
        "history.all_severities",
        SEVERITIES.map((value) => ({ value, label: this.t(`history.${value}`) })),
      )}
    </div>`;
  }

  private flow(flowId: string, entries: Entry[]): TemplateResult {
    const latest = entries.reduce<string | undefined>((timestamp, entry) => {
      const candidate = entry.event?.timestamp;
      if (!candidate || !Number.isFinite(Date.parse(candidate))) return timestamp;
      return !timestamp || Date.parse(candidate) > Date.parse(timestamp) ? candidate : timestamp;
    }, undefined);
    return html`<details class="nc-flow">
      <summary>
        <span>${this.t("history.flow")} ${shortFlowId(flowId)}</span>
        <span>
          ${this.t("history.flow_alert", {
            name: entries[0]?.config?.name || this.t("history.unknown_alert"),
          })}
        </span>
        ${latest ? html`<time datetime=${latest}>${this.t("history.latest_activity", {
          timestamp: formatLocalDateTime(latest, true, this.hass?.locale),
        })}</time>` : nothing}
        <span>${this.t("history.flow_events", { count: entries.length })}</span>
      </summary>
      ${entries.map((entry) => this.item(entry, false))}
    </details>`;
  }

  private item(entry: Entry, showFlow = true): TemplateResult {
    const event = entry.event;
    const details = event?.details;
    const startedBy = historyStartedBySummary(details);
    const name = entry.config?.name || this.t("history.unknown_alert");
    const secondary = [
      formatLocalDateTime(event?.timestamp, true, this.hass?.locale),
      startedBy ? this.t("history.started_by", { trigger: startedBy }) : "",
      details?.reason === "confirmation_notification"
        ? this.t("history.reason", { reason: this.t("history.confirmation_notification") })
        : "",
    ].filter(Boolean);
    return html`<div class="nc-item">
      <div class="nc-item-title">
        ${entry.config?.id
          ? html`<button
              class="nc-link"
              @click=${() => this.emit("history-alert-selected", { alertId: entry.config!.id, alertName: name })}
            >
              ${name}
            </button>`
          : html`<span>${name}</span>`}
        <span class="nc-badge ${historySeverity(event?.type)}">${formatType(event?.type)}</span>
        ${showFlow && event?.flow_id
          ? html`<span class="nc-flow-id">${this.t("history.flow")} ${shortFlowId(event.flow_id)}</span>`
          : nothing}
      </div>
      <div class="nc-muted">${secondary.join(" · ")}</div>
      ${details && Object.keys(details).length
        ? html`<details class="nc-muted">
            <summary>${this.t("history.details")}</summary>
            <pre>${JSON.stringify(details, null, 2)}</pre>
          </details>`
        : nothing}
    </div>`;
  }

  /** Active select filters as removable chips, visible even while the filter panel is closed. */
  private chips(): TemplateResult | typeof nothing {
    const labels: Record<SelectFilter, string | undefined> = {
      alertId: this.alerts.find(({ id }) => id === this.filters.alertId)?.name,
      type: this.filters.type && this.t(`event.${this.filters.type}`, {}, formatType(this.filters.type)),
      severity: this.filters.severity && this.t(`history.${this.filters.severity}`),
    };
    const titles: Record<SelectFilter, string> = {
      alertId: "history.alert",
      type: "history.event_type",
      severity: "history.severity",
    };
    const active = (Object.keys(labels) as SelectFilter[]).filter((key) => this.filters[key]);
    if (!active.length) return nothing;
    return html`<div class="nc-chips">
      ${active.map(
        (key) => html`<ha-filter-chip
          selected
          .label=${`${this.t(titles[key])}: ${labels[key] ?? this.filters[key]}`}
          @click=${(event: Event) => {
            event.preventDefault();
            this.setFilter(key, "");
          }}
        ></ha-filter-chip>`,
      )}
    </div>`;
  }

  private set(mutate: () => void): void {
    mutate();
    localStorage.setItem(
      VIEW_SETTINGS_KEY,
      JSON.stringify({ groupByFlow: this.groupByFlow, showFilters: this.showFilters }),
    );
    this.requestUpdate();
  }

  private setFilter(key: keyof HistoryFilters, value: string): void {
    this.set(() => (this.filters = { ...this.filters, [key]: value }));
  }

  private showAll = (): void => this.emit("history-show-all");

  private emit(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}

if (!customElements.get("ha-notifications-history-view")) {
  customElements.define("ha-notifications-history-view", HistoryView);
}
