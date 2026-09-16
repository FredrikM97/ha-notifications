import { html, render } from "lit";
import { formatLocalDateTime } from "./date-time.js";
import type { Hass, HassLocale, HistoryEntry } from "./types.js";

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
  hass?: Hass;
  locale?: HassLocale;
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

export function historyDetailSummary(
  details: Record<string, unknown> | undefined,
): string {
  if (!details || !Object.keys(details).length) return "";
  if (typeof details.error === "string") return details.error;
  if (typeof details.source === "string") return `Source: ${details.source}`;
  if (Object.keys(details).every((key) => key === "attempt")) return "";
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
      historyDetailSummary(item.details),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes(search);
  });
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
            </div>
            ${hasHistoryFilters(filters)
              ? html`<button
                  class="nc-button secondary nc-history-clear"
                  @click=${() =>
                    options.onFiltersChanged?.(defaultHistoryFilters())}
                >
                  Clear
                </button>`
              : ""}`}
    </div>
    <div class="nc-history-controls">
      <ha-input
        class="nc-history-search"
        type="search"
        label="Search history"
        aria-label="Search history"
        .value=${filters.search}
        @input=${(event: InputEvent) =>
          updateHistoryFilter(
            options,
            "search",
            (event.currentTarget as HTMLInputElement).value,
          )}
      ></ha-input>
      ${options.alerts?.length
        ? html`<ha-selector
            .hass=${options.hass}
            .selector=${{
              select: {
                mode: "dropdown",
                options: [
                  { value: "", label: "All alerts" },
                  ...options.alerts.map((alert) => ({
                    value: alert.id,
                    label: alert.name,
                  })),
                ],
              },
            }}
            .value=${filters.alertId}
            label="Alert"
            aria-label="Filter by alert"
            @value-changed=${(event: CustomEvent<{ value?: string }>) =>
              updateHistoryFilter(options, "alertId", event.detail.value || "")}
          ></ha-selector>`
        : ""}
      <ha-selector
        .hass=${options.hass}
        .selector=${{
          select: {
            mode: "dropdown",
            options: [
              { value: "", label: "All event types" },
              ...(options.types || []).map((type) => ({
                value: type,
                label: formatType(type),
              })),
            ],
          },
        }}
        .value=${filters.type}
        label="Event type"
        aria-label="Filter by event type"
        @value-changed=${(event: CustomEvent<{ value?: string }>) =>
          updateHistoryFilter(options, "type", event.detail.value || "")}
      ></ha-selector>
      <ha-selector
        .hass=${options.hass}
        .selector=${{
          select: {
            mode: "dropdown",
            options: [
              { value: "", label: "All severities" },
              { value: "error", label: "Error" },
              { value: "success", label: "Success" },
              { value: "info", label: "Info" },
              { value: "muted", label: "Muted" },
            ],
          },
        }}
        .value=${filters.severity}
        label="Severity"
        aria-label="Filter by severity"
        @value-changed=${(event: CustomEvent<{ value?: string }>) =>
          updateHistoryFilter(options, "severity", event.detail.value || "")}
      ></ha-selector>
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
  const hasDetails = Boolean(details && Object.keys(details).length);

  return html`<div
    class=${`nc-history-item${hasDetails ? " clickable" : ""}`}
    ?tabindex=${hasDetails}
    role=${hasDetails ? "button" : "none"}
    @click=${hasDetails ? toggleHistoryDetails : undefined}
    @keydown=${hasDetails ? toggleHistoryDetailsWithKeyboard : undefined}
  >
    <div class="nc-history-time">
      ${formatLocalDateTime(item.timestamp, true, options.locale)}
    </div>
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
      ${hasDetails
        ? html`<details class="nc-details nc-history-details">
            <summary>Details</summary>
            <pre>${JSON.stringify(details, null, 2)}</pre>
          </details>`
        : ""}
    </div>
  </div>`;
}

function toggleHistoryDetails(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("button, summary, details")) return;

  const details =
    event.currentTarget instanceof HTMLElement
      ? event.currentTarget.querySelector<HTMLDetailsElement>("details")
      : null;
  if (details) details.open = !details.open;
}

function toggleHistoryDetailsWithKeyboard(event: KeyboardEvent): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleHistoryDetails(event);
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
