import { css, html, LitElement, render } from "lit";
import { ref } from "lit/directives/ref.js";
import { formatLocalDateTime } from "../date-time.js";
import { button, buttonStyles } from "./button.js";
import { localize } from "../localize.js";
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
  historyStartedBySummary,
  historySeverity,
  shortFlowId,
} from "../history/logic.js";
export {
  filterHistoryEntries,
  groupHistoryEntries,
  historyDetailSummary,
  historyStartedBySummary,
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
`;

export const historyFilterStyles = css`
  :host {
    display: block;
    min-width: 0;
    container-type: inline-size;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  button {
    font: inherit;
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

  .nc-history-filter-title {
    font-weight: 700;
  }

  .nc-history-filter-subtitle {
    color: var(--secondary-text-color);
    font-size: 12px;
  }

  @container (max-width: 700px) {
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
`;

export const historyEntriesStyles = css`
  :host {
    display: block;
    min-width: 0;
    container-type: inline-size;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  button {
    font: inherit;
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
  .nc-history-flow-alert,
  .nc-history-flow-count {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .nc-history-flow-alert {
    color: var(--primary-text-color);
    font-weight: 500;
    text-transform: none;
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

  .nc-history-origin {
    color: var(--secondary-text-color);
    font-size: 12px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .nc-history-reason {
    color: var(--secondary-text-color);
    font-size: 12px;
    line-height: 1.4;
    overflow-wrap: anywhere;
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

interface HistoryFilterRenderState extends HistoryRenderOptions {
  onFiltersChanged(filters: HistoryFilters): void;
  onGroupByFlowChanged(groupByFlow: boolean): void;
  onShowAll(): void;
}

interface HistoryEntriesRenderState extends HistoryRenderOptions {
  onAlertSelected(alertId: string, alertName: string): void;
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

function dispatchHistoryEvent(
  target: HTMLElement,
  name: string,
  detail?: unknown,
): void {
  target.dispatchEvent(
    new CustomEvent(name, { detail, bubbles: true, composed: true }),
  );
}

class HistoryViewElement extends LitElement {
  declare history: RuntimeAlertHistoryEntry[];

  declare options: HistoryRenderOptions;

  static properties = {
    history: { attribute: false },
    options: { attribute: false },
  };

  static styles = [buttonStyles, historyViewStyles];

  protected createRenderRoot() {
    return this.shadowRoot || super.createRenderRoot();
  }

  renderImmediately(): void {
    render(this.render(), this.renderRoot || this.createRenderRoot());
  }

  protected render() {
    const options = this.options || {};
    const filters = options.filters || defaultHistoryFilters();
    const filteredHistory = filterHistoryEntries(this.history, filters);
    if (!this.history.length) {
      return emptyHistoryTemplate(options, () =>
        dispatchHistoryEvent(this, "history-show-all"),
      );
    }

    return historyTemplate(filteredHistory, this.history.length, options);
  }
}

customElements.define("ha-notifications-history-view", HistoryViewElement);

class HistoryFilterElement extends LitElement {
  static properties = { options: { attribute: false } };
  static styles = [buttonStyles, historyFilterStyles];

  declare options: HistoryRenderOptions;

  protected render() {
    const options = this.options || {};
    return historyFilterTemplate({
      ...options,
      onFiltersChanged: (filters) =>
        dispatchHistoryEvent(this, "history-filters-changed", filters),
      onGroupByFlowChanged: (groupByFlow) =>
        dispatchHistoryEvent(this, "history-group-by-flow-changed", groupByFlow),
      onShowAll: () => dispatchHistoryEvent(this, "history-show-all"),
    });
  }
}

if (!customElements.get("ha-notifications-history-filter")) {
  customElements.define("ha-notifications-history-filter", HistoryFilterElement);
}

class HistoryEntriesElement extends LitElement {
  static properties = {
    history: { attribute: false },
    totalCount: { attribute: false },
    options: { attribute: false },
  };
  static styles = historyEntriesStyles;

  declare history: RuntimeAlertHistoryEntry[];
  declare totalCount: number;
  declare options: HistoryRenderOptions;

  private expandedDetails = new Set<number>();

  protected render() {
    const history = this.history || [];
    const options: HistoryEntriesRenderState = {
      ...(this.options || {}),
      onAlertSelected: (alertId, alertName) =>
        dispatchHistoryEvent(this, "history-alert-selected", { alertId, alertName }),
    };
    return html`${historyItemsTemplate(
      history,
      options,
      this.expandedDetails,
      this.toggleDetails,
    )}${historyCountTemplate(
      history.length,
      this.totalCount,
      options,
    )}`;
  }

  private toggleDetails = (index: number): void => {
    if (this.expandedDetails.has(index)) {
      this.expandedDetails.delete(index);
    } else {
      this.expandedDetails.add(index);
    }
    this.requestUpdate();
    this.performUpdate();
  };
}

if (!customElements.get("ha-notifications-history-entries")) {
  customElements.define("ha-notifications-history-entries", HistoryEntriesElement);
}

function historyTemplate(
  history: RuntimeAlertHistoryEntry[],
  totalCount: number,
  options: HistoryRenderOptions,
) {
  return html`<div class="nc-history">
    <ha-notifications-history-filter
      .options=${options}
    ></ha-notifications-history-filter>
    <ha-notifications-history-entries
      .history=${history}
      .totalCount=${totalCount}
      .options=${options}
    ></ha-notifications-history-entries>
  </div>`;
}

function historyItemsTemplate(
  history: RuntimeAlertHistoryEntry[],
  options: HistoryEntriesRenderState,
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
  options: HistoryEntriesRenderState,
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

  const alertName = group.entries[0]?.config?.name ||
    localize(options.hass, "history.unknown_alert");

  return html`<details class="nc-history-flow-group">
    <summary class="nc-history-flow-heading">
      <span class="nc-history-flow-name">
        <ha-icon icon="mdi:chevron-down"></ha-icon>
        <span>${localize(options.hass, "history.flow")} ${shortFlowId(group.flowId)}</span>
      </span>
      <span class="nc-history-flow-alert">
        ${localize(options.hass, "history.flow_alert", { name: alertName })}
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

function historyFilterTemplate(options: HistoryFilterRenderState) {
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
  options: HistoryFilterRenderState,
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

function historyGroupToggleTemplate(options: HistoryFilterRenderState) {
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
  options: HistoryFilterRenderState,
  filters: HistoryFilters,
) {
  if (!hasHistoryFilters(filters)) return "";
  return button({
    label: localize(options.hass, "history.clear"),
    variant: "secondary",
    className: "nc-history-clear",
    onClick: () => options.onFiltersChanged(defaultHistoryFilters()),
  });
}

function historySecondaryFiltersTemplate(
  options: HistoryFilterRenderState,
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
  options: HistoryFilterRenderState,
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
  options: HistoryFilterRenderState,
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
  options: HistoryEntriesRenderState,
  detailsOpen: boolean,
  toggleDetails: () => void,
  showFlow = true,
) {
  const details = item.event?.details;
  const hasDetails = Boolean(details && Object.keys(details).length);
  const startedBy = historyStartedBySummary(details);
  const reason = details?.reason === "confirmation_notification"
    ? localize(options.hass, "history.confirmation_notification")
    : "";

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
      ${startedBy
        ? html`<div class="nc-history-origin">${localize(options.hass, "history.started_by", { trigger: startedBy })}</div>`
        : ""}
      ${reason
        ? html`<div class="nc-history-reason">${localize(options.hass, "history.reason", { reason })}</div>`
        : ""}
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
  options: HistoryEntriesRenderState,
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

function emptyHistoryTemplate(
  options: HistoryRenderOptions,
  onShowAll: () => void,
) {
  let title = localize(options.hass, "history.no_activity");
  if (options.alertName) {
    title = localize(options.hass, "history.no_activity_for", { name: options.alertName });
  }

  return html`<div class="nc-empty">
    <h2>${title}</h2>
    <p>${localize(options.hass, "history.activity_help")}</p>
    ${options.alertName
      ? showAllButton(onShowAll, localize(options.hass, "history.show_all"))
      : ""}
  </div>`;
}

function showAllButton(onShowAll: () => void, label: string) {
  return button({ label, variant: "secondary", onClick: onShowAll });
}
