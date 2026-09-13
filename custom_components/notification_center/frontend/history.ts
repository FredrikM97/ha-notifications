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
  render(
    history.length
      ? html`<div class="nc-card nc-history">
          ${options.alertName
            ? html`<div class="nc-history-filter">
                <div>
                  <div class="nc-history-filter-title">
                    History for ${options.alertName}
                  </div>
                  <div class="nc-history-filter-subtitle">
                    Showing events for this alert only.
                  </div>
                </div>
                <button class="nc-button secondary" @click=${options.onShowAll}>
                  Show all
                </button>
              </div>`
            : ""}
          ${history.map(
            (item) => {
              const details = item.details as Record<string, unknown> | undefined;
              const summary = detailSummary(details);
              return html`<div class="nc-history-item">
                <div class="nc-history-time">${formatTime(item.timestamp)}</div>
                <div class="nc-history-main">
                  <div class="nc-history-title">
                    ${item.alert_id
                      ? html`<button
                          class="nc-history-alert-link"
                          @click=${() =>
                            options.onAlertSelected?.(
                              item.alert_id!,
                              item.alert_name || "Unknown alert",
                            )}
                        >
                          ${item.alert_name || "Unknown alert"}
                        </button>`
                      : html`<span>${item.alert_name || "Unknown alert"}</span>`}
                    <span class=${`nc-history-badge ${historySeverity(item.type)}`}
                      >${formatType(item.type)}</span
                    >
                  </div>
                  <div class="nc-history-message">${item.message || ""}</div>
                  ${summary
                    ? html`<div class="nc-history-summary">${summary}</div>`
                    : ""}
                  ${item.details && Object.keys(item.details).length
                    ? html`<details class="nc-details">
                        <summary>Details</summary>
                        <pre>${JSON.stringify(item.details, null, 2)}</pre>
                      </details>`
                    : ""}
                </div>
              </div>`;
            },
          )}
        </div>`
      : html`<div class="nc-card nc-empty">
          <h2>${options.alertName ? `No activity for ${options.alertName}` : "No activity yet"}</h2>
          <p>Notification activity and debug traces will appear here.</p>
          ${options.alertName
            ? html`<button class="nc-button secondary" @click=${options.onShowAll}>
                Show all history
              </button>`
            : ""}
        </div>`,
    container,
  );
}
