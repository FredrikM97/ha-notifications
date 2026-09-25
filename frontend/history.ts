import { html, LitElement, render } from "lit";
import { ref } from "lit/directives/ref.js";
import { formatLocalDateTime } from "./date-time.js";
import { localize } from "./localize.js";
import type {
  Hass,
  HassLocale,
  RuntimeAlertHistoryEntry,
} from "./types.js";
import {
  filterHistoryEntries,
  formatType,
  historyDetailSummary,
  historySeverity,
  shortFlowId,
} from "./history/logic.js";
export { filterHistoryEntries, historyDetailSummary } from "./history/logic.js";

export type { HistoryFilters } from "./history/logic.js";
import type { HistoryFilters } from "./history/logic.js";

export interface HistoryAlertOption {
  id: string;
  name: string;
}

export interface HistoryRenderOptions {
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

export function renderHistory(
  container: HTMLElement,
  history: RuntimeAlertHistoryEntry[],
  options: HistoryRenderOptions = {},
): void {
  let element: HistoryViewElement | undefined;
  render(
    html`<ha-notifications-history-view
      .history=${history}
      .options=${options}
      ${ref((value) => {
        element = value as HistoryViewElement;
      })}
    ></ha-notifications-history-view>`,
    container,
  );
  element?.renderImmediately();
}

class HistoryViewElement extends LitElement {
  declare history: RuntimeAlertHistoryEntry[];

  declare options: HistoryRenderOptions;

  private expandedDetails = new Set<number>();

  static properties = {
    history: { attribute: false },
    options: { attribute: false },
  };

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  renderImmediately(): void {
    render(this.render(), this);
  }

  protected render() {
    const filters = this.options.filters || defaultHistoryFilters();
    const filteredHistory = filterHistoryEntries(this.history, filters);
    if (!this.history.length) {
      return emptyHistoryTemplate(this.options);
    }

    return historyTemplate(
      filteredHistory,
      this.history.length,
      this.options,
      this.expandedDetails,
      (index) => {
        if (this.expandedDetails.has(index)) {
          this.expandedDetails.delete(index);
        } else {
          this.expandedDetails.add(index);
        }
        this.renderImmediately();
      },
    );
  }
}

customElements.define("ha-notifications-history-view", HistoryViewElement);

function historyTemplate(
  history: RuntimeAlertHistoryEntry[],
  totalCount: number,
  options: HistoryRenderOptions,
  expandedDetails: Set<number>,
  toggleDetails: (index: number) => void,
) {
  return html`<div class="nc-card nc-history">
    ${historyFilterTemplate(options)}
    ${historyItemsTemplate(history, options, expandedDetails, toggleDetails)}
    ${historyCountTemplate(history.length, totalCount, options)}
  </div>`;
}

function historyItemsTemplate(
  history: RuntimeAlertHistoryEntry[],
  options: HistoryRenderOptions,
  expandedDetails: Set<number>,
  toggleDetails: (index: number) => void,
) {
  if (!history.length) {
    return html`<div class="nc-history-no-results">
      ${localize(options.hass, "history.no_matches")}
    </div>`;
  }

  return history.map((item, index) =>
    historyItemTemplate(
      item,
      options,
      expandedDetails.has(index),
      () => toggleDetails(index),
    ),
  );
}

function historyCountTemplate(
  count: number,
  totalCount: number,
  options: HistoryRenderOptions,
) {
  if (!count || count === totalCount) return "";
  return html`<div class="nc-history-count">
    ${localize(options.hass, "history.showing", { count, total: totalCount })}
  </div>`;
}

function historyFilterTemplate(options: HistoryRenderOptions) {
  const filters = options.filters || defaultHistoryFilters();
  const activeFilterCount = countSecondaryHistoryFilters(filters);
  return html`<div class="nc-history-filter">
    <div class="nc-history-filter-heading">
      ${historyHeadingTemplate(options, filters, activeFilterCount)}
    </div>
    <div class="nc-history-controls">
      <ha-input
        class="nc-history-search"
        type="search"
        label=${localize(options.hass, "history.search")}
        aria-label=${localize(options.hass, "history.search")}
        .value=${filters.search}
        @input=${(event: InputEvent) =>
          updateHistoryFilter(
            options,
            "search",
            (event.currentTarget as HTMLInputElement).value,
          )}
      ></ha-input>
    </div>
  </div>`;
}

function historyHeadingTemplate(
  options: HistoryRenderOptions,
  filters: HistoryFilters,
  activeFilterCount: number,
) {
  if (options.alertName) {
    return html`<div>
        <div class="nc-history-filter-title">${localize(options.hass, "history.for_alert", { name: options.alertName })}</div>
        <div class="nc-history-filter-subtitle">
          ${localize(options.hass, "history.alert_only")}
        </div>
      </div>
      ${showAllButton(options.onShowAll, localize(options.hass, "panel.show_all"))}`;
  }

  return html`<div class="nc-history-filter-main">
      <div class="nc-history-filter-row">
        <div class="nc-history-filter-label">
          <ha-icon icon="mdi:filter-variant"></ha-icon>
          <span>${localize(options.hass, "history.filter")}</span>
        </div>
        <details class="nc-history-filter-details" ?open=${activeFilterCount > 0}>
          <summary>
            <ha-icon icon="mdi:filter-variant"></ha-icon>
            <span>${localize(options.hass, "history.more_filters")}</span>
            ${historyFilterCountTemplate(activeFilterCount)}
            <ha-icon
              class="nc-history-filter-chevron"
              icon="mdi:chevron-down"
            ></ha-icon>
          </summary>
        </details>
      </div>
      ${historySecondaryFiltersTemplate(options, filters)}
    </div>
    ${historyClearButtonTemplate(options, filters)}`;
}

function historyFilterCountTemplate(count: number) {
  if (!count) return "";
  return html`<span class="nc-history-filter-count">${count}</span>`;
}

function historyClearButtonTemplate(
  options: HistoryRenderOptions,
  filters: HistoryFilters,
) {
  if (!hasHistoryFilters(filters)) return "";
  return html`<button
    class="nc-button secondary nc-history-clear"
    @click=${() => options.onFiltersChanged?.(defaultHistoryFilters())}
  >
    ${localize(options.hass, "history.clear")}
  </button>`;
}

function historySecondaryFiltersTemplate(
  options: HistoryRenderOptions,
  filters: HistoryFilters,
) {
  return html`<div class="nc-history-secondary-controls">
    ${alertFilterTemplate(options, filters)}
    <ha-selector
      .hass=${options.hass}
      .selector=${{
        select: {
          mode: "dropdown",
          options: [
            { value: "", label: localize(options.hass, "history.all_event_types") },
            ...(options.types || []).map((type) => ({
              value: type,
              label: localize(options.hass, `event.${type}`, {}, formatType(type)),
            })),
          ],
        },
      }}
      .value=${filters.type}
      label=${localize(options.hass, "history.event_type")}
      aria-label=${localize(options.hass, "history.filter_event_type")}
      @value-changed=${(event: CustomEvent<{ value?: string }>) =>
        updateHistoryFilter(options, "type", event.detail.value || "")}
    ></ha-selector>
    <ha-selector
      .hass=${options.hass}
      .selector=${{
        select: {
          mode: "dropdown",
          options: [
            { value: "", label: localize(options.hass, "history.all_severities") },
            { value: "error", label: localize(options.hass, "history.error") },
            { value: "success", label: localize(options.hass, "history.success") },
            { value: "info", label: localize(options.hass, "history.info") },
            { value: "muted", label: localize(options.hass, "history.muted") },
          ],
        },
      }}
      .value=${filters.severity}
      label=${localize(options.hass, "history.severity")}
      aria-label=${localize(options.hass, "history.filter_severity")}
      @value-changed=${(event: CustomEvent<{ value?: string }>) =>
        updateHistoryFilter(options, "severity", event.detail.value || "")}
    ></ha-selector>
  </div>`;
}

function alertFilterTemplate(
  options: HistoryRenderOptions,
  filters: HistoryFilters,
) {
  if (!options.alerts?.length) return "";
  return html`<ha-selector
    .hass=${options.hass}
    .selector=${{
      select: {
        mode: "dropdown",
        options: [
          { value: "", label: localize(options.hass, "history.all_alerts") },
          ...options.alerts.map((alert) => ({
            value: alert.id,
            label: alert.name,
          })),
        ],
      },
    }}
    .value=${filters.alertId}
    label=${localize(options.hass, "history.alert")}
    aria-label=${localize(options.hass, "history.filter_alert")}
    @value-changed=${(event: CustomEvent<{ value?: string }>) =>
      updateHistoryFilter(options, "alertId", event.detail.value || "")}
  ></ha-selector>`;
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
  return countHistoryFilters(filters) > 0;
}

function countHistoryFilters(filters: HistoryFilters): number {
  return [filters.search, filters.alertId, filters.type, filters.severity].filter(
    Boolean,
  ).length;
}

function countSecondaryHistoryFilters(filters: HistoryFilters): number {
  return [filters.alertId, filters.type, filters.severity].filter(Boolean).length;
}

function historyItemTemplate(
  item: RuntimeAlertHistoryEntry,
  options: HistoryRenderOptions,
  detailsOpen: boolean,
  toggleDetails: () => void,
) {
  const details = item.event?.details;
  const hasDetails = Boolean(details && Object.keys(details).length);

  return html`<div
    class=${`nc-history-item${hasDetails ? " clickable" : ""}`}
    ?tabindex=${hasDetails}
    role=${hasDetails ? "button" : "none"}
    @click=${hasDetails ? toggleDetails : undefined}
    @keydown=${
      hasDetails
        ? (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            toggleDetails();
          }
        : undefined
    }
  >
    <div class="nc-history-time">
      ${formatLocalDateTime(item.event?.timestamp, true, options.locale)}
    </div>
    <div class="nc-history-main">
      <div class="nc-history-title">
        ${historyAlertTemplate(item, options)}
        <span class=${`nc-history-badge ${historySeverity(item.event?.type)}`}
          >${formatType(item.event?.type)}</span
        >
            ${item.state?.flow_id
            ? html`<span class="nc-history-flow"
              >${localize(options.hass, "history.flow")} ${shortFlowId(item.state.flow_id)}</span
            >`
          : ""}
      </div>
      ${historyDetailsTemplate(details, hasDetails, detailsOpen)}
    </div>
  </div>`;
}

function historyDetailsTemplate(
  details: Record<string, unknown> | undefined,
  hasDetails: boolean,
  detailsOpen: boolean,
) {
  if (!hasDetails) return "";
  return html`<details
    class="nc-details nc-history-details"
    ?open=${detailsOpen}
    @click=${(event: Event) => event.stopPropagation()}
  >
    <summary>${localize(undefined, "history.details")}</summary>
    <pre>${JSON.stringify(details, null, 2)}</pre>
  </details>`;
}

function historyAlertTemplate(
  item: RuntimeAlertHistoryEntry,
  options: HistoryRenderOptions,
) {
  const alertName = item.config?.name || localize(options.hass, "history.unknown_alert");
  if (!item.config?.id) {
    return html`<span>${alertName}</span>`;
  }

  return html`<button
    class="nc-history-alert-link"
    @click=${(event: Event) => {
      event.stopPropagation();
      options.onAlertSelected?.(item.config.id, alertName);
    }}
  >
    ${alertName}
  </button>`;
}

function emptyHistoryTemplate(options: HistoryRenderOptions) {
  let title = localize(options.hass, "history.no_activity");
  if (options.alertName) {
    title = localize(options.hass, "history.no_activity_for", { name: options.alertName });
  }

  return html`<div class="nc-card nc-empty">
    <h2>${title}</h2>
    <p>${localize(options.hass, "history.activity_help")}</p>
    ${options.alertName
      ? showAllButton(options.onShowAll, localize(options.hass, "history.show_all"))
      : ""}
  </div>`;
}

function showAllButton(onShowAll: (() => void) | undefined, label: string) {
  return html`<button class="nc-button secondary" @click=${onShowAll}>
    ${label}
  </button>`;
}
