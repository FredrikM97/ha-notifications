import { html, render } from "lit";
import type { HistoryEntry } from "./types.js";

interface HistoryRenderOptions {
  alertName?: string | null;
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

export function renderHistory(
  container: HTMLElement,
  history: HistoryEntry[],
  options: HistoryRenderOptions = {},
): void {
  let content = emptyHistoryTemplate(options);
  if (history.length) {
    content = historyTemplate(history, options);
  }

  render(content, container);
}

function historyTemplate(
  history: HistoryEntry[],
  options: HistoryRenderOptions,
) {
  return html`<div class="nc-card nc-history">
    ${historyFilterTemplate(options)}
    ${history.map((item) => historyItemTemplate(item, options))}
  </div>`;
}

function historyFilterTemplate(options: HistoryRenderOptions) {
  if (!options.alertName) {
    return "";
  }

  return html`<div class="nc-history-filter">
    <div>
      <div class="nc-history-filter-title">
        History for ${options.alertName}
      </div>
      <div class="nc-history-filter-subtitle">
        Showing events for this alert only.
      </div>
    </div>
    ${showAllButton(options.onShowAll, "Show all")}
  </div>`;
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
      <div class="nc-history-message">${item.message || ""}</div>
      ${summary
        ? html`<div class="nc-history-summary">${summary}</div>`
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
