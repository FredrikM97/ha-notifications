import { css, html, LitElement, render } from "lit";
import { ref } from "lit/directives/ref.js";
import { formatLocalDateTime } from "../date-time.js";
import { buttonStyles } from "./button.js";
import { localize } from "../localize.js";
import { sharedStyles } from "./shared-styles.js";
import type {
  Hass,
  HassLocale,
  RuntimeAlertHistoryEntry,
} from "../types.js";
import {
  filterHistoryEntries,
  formatType,
  groupHistoryEntries,
  historyDetailSummary,
  historySeverity,
  shortFlowId,
} from "../history/logic.js";
export {
  filterHistoryEntries,
  groupHistoryEntries,
  historyDetailSummary,
} from "../history/logic.js";

export type { HistoryFilters } from "../history/logic.js";
import type { HistoryFilters, HistoryFlowGroup } from "../history/logic.js";

export const historyViewStyles = css`
  :host {
    display: block;
    container-type: inline-size;
    color: var(--primary-text-color);
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  button {
    font: inherit;
  }

  .nc-history {
    display: grid;
    gap: 8px;
    padding: 16px;
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow);
  }

  .nc-history-filter {
    position: sticky;
    top: 0;
    z-index: 1;
    display: grid;
    gap: 12px;
    padding: 4px 0 12px;
    border-bottom: 1px solid var(--divider-color);
    background: var(--card-background-color);
  }

  .nc-history-filter-heading,
  .nc-history-controls {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 8px;
  }

  .nc-history-filter-details {
    min-width: 0;
  }

  .nc-history-filter-main {
    display: grid;
    gap: 10px;
    min-width: 0;
  }

  .nc-history-filter-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
  }

  .nc-history-filter-details summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 0 10px;
    border: 1px solid var(--divider-color);
    border-radius: var(--ha-border-radius-s, 4px);
    color: var(--secondary-text-color);
    cursor: pointer;
    font-size: 13px;
    list-style: none;
    white-space: nowrap;
  }

  .nc-history-filter-details summary:hover {
    background: var(--secondary-background-color);
  }

  .nc-history-filter-details[open] summary {
    border-color: var(--primary-color);
    background: color-mix(
      in srgb,
      var(--primary-color) 10%,
      var(--card-background-color)
    );
    color: var(--primary-text-color);
  }

  .nc-history-filter-details summary::-webkit-details-marker {
    display: none;
  }

  .nc-history-filter-details summary ha-icon {
    --mdc-icon-size: 18px;
  }

  .nc-history-filter-chevron {
    transition: transform 160ms ease;
  }

  .nc-history-filter-details[open] .nc-history-filter-chevron {
    transform: rotate(180deg);
  }

  .nc-history-filter-count {
    display: inline-grid;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    place-items: center;
    border-radius: 9px;
    background: var(--primary-color);
    color: var(--text-primary-color);
    font-size: 11px;
    font-weight: 700;
  }

  .nc-history-secondary-controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-top: 10px;
    padding: 0;
  }

  .nc-history-filter-main:not(:has(.nc-history-filter-details[open]))
    .nc-history-secondary-controls {
    display: none;
  }

  .nc-history-filter-heading {
    align-items: center;
    justify-content: space-between;
  }

  .nc-history-filter-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    color: var(--secondary-text-color);
    font-size: 13px;
    font-weight: 700;
  }

  .nc-history-filter-label ha-icon {
    --mdc-icon-size: 18px;
    color: var(--primary-color);
  }

  .nc-history-filter-heading .nc-history-clear {
    min-height: 0;
    padding: 0;
    background: transparent;
    color: var(--secondary-text-color);
    font-size: 13px;
    line-height: 18px;
  }

  .nc-history-controls ha-input {
    --ha-input-padding-bottom: 0px;
    min-height: 36px;
    box-sizing: border-box;
  }

  .nc-history-controls ha-selector {
    flex: 0 1 180px;
    min-width: 150px;
    min-height: 36px;
    box-sizing: border-box;
  }

  .nc-history-group-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    margin-left: auto;
    color: var(--secondary-text-color);
    font-size: 13px;
    white-space: nowrap;
  }

  .nc-history-group-toggle ha-switch {
    --mdc-switch-scale: 0.8;
  }

  .nc-history-secondary-controls ha-selector {
    min-width: 0;
  }

  .nc-history-search {
    flex: 1 1 220px;
    min-width: 180px;
  }

  .nc-history-flow-group {
    border-bottom: 1px solid var(--divider-color);
  }

  .nc-history-flow-group:last-child {
    border-bottom: 0;
  }

  .nc-history-flow-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 0 6px;
    color: var(--secondary-text-color);
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    list-style: none;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .nc-history-flow-heading::-webkit-details-marker {
    display: none;
  }

  .nc-history-flow-name,
  .nc-history-flow-count {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .nc-history-flow-name ha-icon {
    --mdc-icon-size: 18px;
    transition: transform 160ms ease;
  }

  .nc-history-flow-group:not([open]) .nc-history-flow-name ha-icon {
    transform: rotate(-90deg);
  }

  .nc-history-flow-heading:hover {
    color: var(--primary-text-color);
  }

  .nc-history-flow-events .nc-history-item {
    padding-left: 8px;
  }

  .nc-history-no-results,
  .nc-history-count {
    padding: 16px 0;
    color: var(--secondary-text-color);
  }

  .nc-history-count {
    padding-top: 4px;
    font-size: 12px;
  }

  .nc-history-filter-title {
    font-weight: 700;
  }

  .nc-history-filter-subtitle {
    color: var(--secondary-text-color);
    font-size: 12px;
  }

  .nc-history-item {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    padding: 9px 6px;
    border-bottom: 1px solid var(--divider-color);
  }

  .nc-history-item.clickable {
    cursor: pointer;
  }

  .nc-history-item.clickable:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: -2px;
  }

  .nc-history-time {
    color: var(--secondary-text-color);
    font-size: 12px;
  }

  .nc-history-main {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .nc-history-title {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    min-width: 0;
    gap: 6px;
    font-weight: 700;
  }

  .nc-history-alert-link {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--primary-color);
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .nc-history-alert-link:hover {
    text-decoration: underline;
  }

  .nc-history-title .nc-history-alert-link {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nc-history-title .nc-history-badge,
  .nc-history-title .nc-history-flow {
    flex: 0 0 auto;
  }

  .nc-history-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 2px 7px;
    font-size: 11px;
    font-weight: 700;
  }

  .nc-history-badge.error {
    background: rgba(244, 67, 54, 0.14);
    color: var(--error-color);
  }

  .nc-history-badge.success {
    background: rgba(76, 175, 80, 0.14);
    color: var(--success-color, #4caf50);
  }

  .nc-history-badge.info {
    background: rgba(33, 150, 243, 0.12);
    color: var(--info-color, #2196f3);
  }

  .nc-history-badge.muted {
    background: var(--secondary-background-color);
    color: var(--secondary-text-color);
  }

  .nc-history-flow {
    display: inline-flex;
    align-items: center;
    max-width: 180px;
    overflow: hidden;
    border: 1px solid var(--divider-color);
    border-radius: 999px;
    padding: 2px 7px;
    color: var(--secondary-text-color);
    font-family: monospace;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nc-details {
    margin-top: 6px;
    color: var(--secondary-text-color);
    font-size: 12px;
  }

  .nc-details summary {
    cursor: pointer;
  }

  .nc-history-details {
    margin-top: 0;
  }

  .nc-details pre {
    margin: 6px 0 0;
    padding: 8px;
    border-radius: 6px;
    background: var(--secondary-background-color);
    white-space: pre-wrap;
  }

  @container (max-width: 700px) {
    .nc-history-item {
      grid-template-columns: 1fr;
      gap: 4px;
    }

    .nc-history-filter-heading {
      align-items: center;
      flex-direction: row;
      gap: 8px;
    }

    .nc-history-filter-main {
      flex: 1 1 auto;
      min-width: 0;
    }

    .nc-history-filter-row {
      align-items: center;
    }

    .nc-history-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .nc-history-controls .nc-history-search {
      min-width: 0;
    }

    .nc-history-controls ha-input {
      width: 100%;
    }

    .nc-history-filter-details {
      min-width: 0;
    }

    .nc-history-filter-details summary {
      justify-content: center;
      width: 100%;
      padding: 0 8px;
    }

    .nc-history-secondary-controls {
      display: grid;
      grid-template-columns: 1fr;
      margin-top: 8px;
    }

    .nc-history-secondary-controls ha-selector {
      width: 100%;
    }
  }

  @media (max-width: 700px) {
    .nc-history-item {
      grid-template-columns: 1fr;
      gap: 4px;
    }

    .nc-history-filter-heading {
      align-items: center;
      flex-direction: row;
      gap: 8px;
    }

    .nc-history-filter-main {
      flex: 1 1 auto;
      min-width: 0;
    }

    .nc-history-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .nc-history-controls ha-input {
      width: 100%;
    }

    .nc-history-filter-details {
      min-width: 0;
    }

    .nc-history-filter-details summary {
      justify-content: center;
      width: 100%;
      padding: 0 8px;
    }

    .nc-history-secondary-controls {
      display: grid;
      grid-template-columns: 1fr;
      margin-top: 8px;
    }

    .nc-history-secondary-controls ha-selector {
      width: 100%;
    }
  }
`;

export interface HistoryAlertOption {
  id: string;
  name: string;
}

export interface HistoryRenderOptions {
  alertName?: string | null;
  alerts?: HistoryAlertOption[];
  filters?: HistoryFilters;
  groupByFlow?: boolean;
  hass?: Hass;
  locale?: HassLocale;
  types?: string[];
}

interface HistoryRenderState extends HistoryRenderOptions {
  onFiltersChanged(filters: HistoryFilters): void;
  onGroupByFlowChanged(groupByFlow: boolean): void;
  onAlertSelected(alertId: string, alertName: string): void;
  onShowAll(): void;
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

  static styles = [buttonStyles, sharedStyles, historyViewStyles];

  protected createRenderRoot() {
    return this.shadowRoot || super.createRenderRoot();
  }

  renderImmediately(): void {
    render(this.render(), this.renderRoot || this.createRenderRoot());
  }

  protected render() {
    const options = this.renderState();
    const filters = options.filters || defaultHistoryFilters();
    const filteredHistory = filterHistoryEntries(this.history, filters);
    if (!this.history.length) {
      return emptyHistoryTemplate(options);
    }

    return historyTemplate(
      filteredHistory,
      this.history.length,
      options,
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

  private renderState(): HistoryRenderState {
    return {
      ...this.options,
      onFiltersChanged: (filters) =>
        this.dispatchHistoryEvent("history-filters-changed", filters),
      onGroupByFlowChanged: (groupByFlow) =>
        this.dispatchHistoryEvent("history-group-by-flow-changed", groupByFlow),
      onAlertSelected: (alertId, alertName) =>
        this.dispatchHistoryEvent("history-alert-selected", { alertId, alertName }),
      onShowAll: () => this.dispatchHistoryEvent("history-show-all"),
    };
  }

  private dispatchHistoryEvent(name: string, detail?: unknown): void {
    this.dispatchEvent(
      new CustomEvent(name, { detail, bubbles: true, composed: true }),
    );
  }
}

customElements.define("ha-notifications-history-view", HistoryViewElement);

function historyTemplate(
  history: RuntimeAlertHistoryEntry[],
  totalCount: number,
  options: HistoryRenderState,
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
    options: HistoryRenderState,
  expandedDetails: Set<number>,
  toggleDetails: (index: number) => void,
) {
  if (!history.length) {
    return html`<div class="nc-history-no-results">
      ${localize(options.hass, "history.no_matches")}
    </div>`;
  }

  if (!options.groupByFlow) {
    return history.map((item, index) =>
      historyItemTemplate(
        item,
        options,
        expandedDetails.has(index),
        () => toggleDetails(index),
      ),
    );
  }

  let index = 0;
  return groupHistoryEntries(history).map((group) => {
    const startIndex = index;
    index += group.entries.length;
    return historyFlowGroupTemplate(
      group,
      options,
      expandedDetails,
      startIndex,
      toggleDetails,
    );
  });
}

function historyFlowGroupTemplate(
  group: HistoryFlowGroup,
    options: HistoryRenderState,
  expandedDetails: Set<number>,
  startIndex: number,
  toggleDetails: (index: number) => void,
) {
  if (!group.flowId) {
    return historyItemTemplate(
      group.entries[0],
      options,
      expandedDetails.has(startIndex),
      () => toggleDetails(startIndex),
    );
  }

  return html`<details class="nc-history-flow-group" open>
    <summary class="nc-history-flow-heading">
      <span class="nc-history-flow-name">
        <ha-icon icon="mdi:chevron-down"></ha-icon>
        <span>${localize(options.hass, "history.flow")} ${shortFlowId(group.flowId)}</span>
      </span>
      <span class="nc-history-flow-count">${localize(options.hass, "history.flow_events", { count: group.entries.length })}</span>
    </summary>
    <div class="nc-history-flow-events">
      ${group.entries.map((item, offset) =>
        historyItemTemplate(
          item,
          options,
          expandedDetails.has(startIndex + offset),
          () => toggleDetails(startIndex + offset),
          false,
        ),
      )}
    </div>
  </details>`;
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

function historyFilterTemplate(options: HistoryRenderState) {
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
  options: HistoryRenderState,
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
        ${historyGroupToggleTemplate(options)}
      </div>
      ${historySecondaryFiltersTemplate(options, filters)}
    </div>
    ${historyClearButtonTemplate(options, filters)}`;
}

function historyGroupToggleTemplate(options: HistoryRenderState) {
  return html`<label class="nc-history-group-toggle">
    <ha-switch
      .checked=${options.groupByFlow === true}
      @change=${(event: Event) =>
        options.onGroupByFlowChanged?.((event.currentTarget as HTMLElement & { checked: boolean }).checked)}
    ></ha-switch>
    <span>${localize(options.hass, "history.group_by_flow")}</span>
  </label>`;
}

function historyFilterCountTemplate(count: number) {
  if (!count) return "";
  return html`<span class="nc-history-filter-count">${count}</span>`;
}

function historyClearButtonTemplate(
  options: HistoryRenderState,
  filters: HistoryFilters,
) {
  if (!hasHistoryFilters(filters)) return "";
  return html`<button
    class="nc-button secondary nc-history-clear"
    @click=${() => options.onFiltersChanged(defaultHistoryFilters())}
  >
    ${localize(options.hass, "history.clear")}
  </button>`;
}

function historySecondaryFiltersTemplate(
  options: HistoryRenderState,
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
  options: HistoryRenderState,
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
  options: HistoryRenderState,
  key: keyof HistoryFilters,
  value: string,
): void {
  const filters = options.filters || defaultHistoryFilters();
  options.onFiltersChanged({ ...filters, [key]: value });
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
  options: HistoryRenderState,
  detailsOpen: boolean,
  toggleDetails: () => void,
  showFlow = true,
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
            ${showFlow && item.event?.flow_id
            ? html`<span class="nc-history-flow"
              >${localize(options.hass, "history.flow")} ${shortFlowId(item.event.flow_id)}</span
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
  options: HistoryRenderState,
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

function emptyHistoryTemplate(options: HistoryRenderState) {
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

function showAllButton(onShowAll: () => void, label: string) {
  return html`<button class="nc-button secondary" @click=${onShowAll}>
    ${label}
  </button>`;
}
