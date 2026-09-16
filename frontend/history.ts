import { html, render } from "lit";
import type { HistoryEntry } from "./types.js";

export interface HistoryFilters {
  search: string;
  alertId: string;
  type: string;
  severity: string;
}

export interface HistoryAlertOption {
  id: string;
  name: string;
}

interface HistoryRenderOptions {
  alertName?: string | null;
  alerts?: HistoryAlertOption[];
  filters?: HistoryFilters;
  types?: string[];
  onFiltersChanged?: (filters: HistoryFilters) => void;
  onAlertSelected?: (alertId: string, alertName: string) => void;
  onShowAll?: () => void;
}

function historySeverity(type: string | undefined): string {
  if (!type) return "info";
  if (type.includes("failed") || type.includes("error")) return "error";
  if (type.includes("confirmed") || type.includes("sent")) return "success";
  if (type.includes("inactive")) return "muted";
  return "info";
}

function formatTime(value: string | undefined): string {
  if (!value) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(value));
  } catch (_err) {
    return value;
  }
}

function formatType(value: string | undefined): string {
  return String(value || "event").replaceAll("_", " ");
}

function shortFlowId(value: string | undefined): string {
  if (!value) return "";
  if (value.length > 18) {
    return value.slice(-12);
  }

  return value;
}

function detailSummary(details: Record<string, unknown> | undefined): string {
  if (!details || !Object.keys(details).length) return "";
  if (typeof details.error === "string") return details.error;
  if (typeof details.source === "string") return `Source: ${details.source}`;
  return JSON.stringify(details);
}

export function filterHistoryEntries(
  history: HistoryEntry[],
  filters: HistoryFilters,
): HistoryEntry[] {
  const search = filters.search.trim().toLowerCase();

  return history.filter((item) => {
    if (filters.alertId && item.alert_id !== filters.alertId) return false;
    if (filters.type && item.type !== filters.type) return false;
    if (filters.severity && historySeverity(item.type) !== filters.severity) {
      return false;
    }
    if (!search) return true;

    const searchable = [
      item.alert_name,
      item.message,
      item.type,
      item.flow_id,
      detailSummary(item.details),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes(search);
  });
}

export function historyMessage(item: HistoryEntry): string {
  if (
    item.type === "notification_sent" &&
    item.message === "Notification sent." &&
    item.details &&
    "attempt" in item.details
  ) {
    return "";
  }

  return item.message || "";
}

export function renderHistory(
  container: HTMLElement,
  history: HistoryEntry[],
  options: HistoryRenderOptions = {},
): void {
  const filters = options.filters || defaultHistoryFilters();
  const filteredHistory = filterHistoryEntries(history, filters);
  let content = emptyHistoryTemplate(options);
  if (history.length) {
    content = historyTemplate(filteredHistory, history.length, options);
  }

  render(content, container);
}

function historyTemplate(
  history: HistoryEntry[],
  totalCount: number,
  options: HistoryRenderOptions,
) {
  return html`<div class="nc-card nc-history">
    ${historyFilterTemplate(options)}
    ${history.length
      ? history.map((item) => historyItemTemplate(item, options))
      : html`<div class="nc-history-no-results">
          No history entries match these filters.
        </div>`}
    ${history.length && history.length !== totalCount
      ? html`<div class="nc-history-count">
          Showing ${history.length} of ${totalCount} events
        </div>`
      : ""}
  </div>`;
}

function historyFilterTemplate(options: HistoryRenderOptions) {
  const filters = options.filters || defaultHistoryFilters();
  return html`<div class="nc-history-filter">
    <div class="nc-history-filter-heading">
      ${options.alertName
        ? html`<div>
              <div class="nc-history-filter-title">
                History for ${options.alertName}
              </div>
              <div class="nc-history-filter-subtitle">
                Showing events for this alert only.
              </div>
            </div>
            ${showAllButton(options.onShowAll, "Show all")}`
        : html`<div class="nc-history-filter-label">
            <ha-icon icon="mdi:filter-variant"></ha-icon>
            <span>Filter history</span>
          </div>`}
    </div>
    <div class="nc-history-controls">
      <input
        class="nc-history-search"
        type="search"
        placeholder="Search history"
        aria-label="Search history"
        .value=${filters.search}
        @input=${(event: InputEvent) =>
          updateHistoryFilter(
            options,
            "search",
            (event.target as HTMLInputElement).value,
          )}
      />
      ${options.alerts?.length
        ? html`<select
            .value=${filters.alertId}
            aria-label="Filter by alert"
            @change=${(event: Event) =>
              updateHistoryFilter(
                options,
                "alertId",
                (event.target as HTMLSelectElement).value,
              )}
          >
            <option value="">All alerts</option>
            ${options.alerts.map(
              (alert) => html`<option value=${alert.id}>${alert.name}</option>`,
            )}
          </select>`
        : ""}
      <select
        .value=${filters.type}
        aria-label="Filter by event type"
        @change=${(event: Event) =>
          updateHistoryFilter(
            options,
            "type",
            (event.target as HTMLSelectElement).value,
          )}
      >
        <option value="">All event types</option>
        ${(options.types || []).map(
          (type) => html`<option value=${type}>${formatType(type)}</option>`,
        )}
      </select>
      <select
        .value=${filters.severity}
        aria-label="Filter by severity"
        @change=${(event: Event) =>
          updateHistoryFilter(
            options,
            "severity",
            (event.target as HTMLSelectElement).value,
          )}
      >
        <option value="">All severities</option>
        <option value="error">Error</option>
        <option value="success">Success</option>
        <option value="info">Info</option>
        <option value="muted">Muted</option>
      </select>
      ${hasHistoryFilters(filters)
        ? html`<button
            class="nc-button secondary nc-history-clear"
            @click=${() => options.onFiltersChanged?.(defaultHistoryFilters())}
          >
            Clear
          </button>`
        : ""}
    </div>
  </div>`;
}

function defaultHistoryFilters(): HistoryFilters {
  return { search: "", alertId: "", type: "", severity: "" };
}

function updateHistoryFilter(
  options: HistoryRenderOptions,
  key: keyof HistoryFilters,
  value: string,
): void {
  const filters = options.filters || defaultHistoryFilters();
  options.onFiltersChanged?.({ ...filters, [key]: value });
}

function hasHistoryFilters(filters: HistoryFilters): boolean {
  return Boolean(
    filters.search || filters.alertId || filters.type || filters.severity,
  );
}

function historyItemTemplate(
  item: HistoryEntry,
  options: HistoryRenderOptions,
) {
  const details = item.details as Record<string, unknown> | undefined;
  const summary = detailSummary(details);

  return html`<div class="nc-history-item">
    <div class="nc-history-time">${formatTime(item.timestamp)}</div>
    <div class="nc-history-main">
      <div class="nc-history-title">
        ${historyAlertTemplate(item, options)}
        <span class=${`nc-history-badge ${historySeverity(item.type)}`}
          >${formatType(item.type)}</span
        >
        ${item.flow_id
          ? html`<span class="nc-history-flow"
              >Flow ${shortFlowId(item.flow_id)}</span
            >`
          : ""}
      </div>
      ${historyMessage(item)
        ? html`<div class="nc-history-message">${historyMessage(item)}</div>`
        : ""}
      ${summary
        ? html`<div>${summary}</div>`
        : ""}${item.details && Object.keys(item.details).length
        ? html`<details class="nc-details">
            <summary>Details</summary>
            <pre>${JSON.stringify(item.details, null, 2)}</pre>
          </details>`
        : ""}
    </div>
  </div>`;
}

function historyAlertTemplate(
  item: HistoryEntry,
  options: HistoryRenderOptions,
) {
  const alertName = item.alert_name || "Unknown alert";
  if (!item.alert_id) {
    return html`<span>${alertName}</span>`;
  }

  return html`<button
    class="nc-history-alert-link"
    @click=${() => options.onAlertSelected?.(item.alert_id!, alertName)}
  >
    ${alertName}
  </button>`;
}

function emptyHistoryTemplate(options: HistoryRenderOptions) {
  let title = "No activity yet";
  if (options.alertName) {
    title = `No activity for ${options.alertName}`;
  }

  return html`<div class="nc-card nc-empty">
    <h2>${title}</h2>
    <p>Notification activity and debug traces will appear here.</p>
    ${options.alertName
      ? showAllButton(options.onShowAll, "Show all history")
      : ""}
  </div>`;
}

function showAllButton(onShowAll: (() => void) | undefined, label: string) {
  return html`<button class="nc-button secondary" @click=${onShowAll}>
    ${label}
  </button>`;
}
