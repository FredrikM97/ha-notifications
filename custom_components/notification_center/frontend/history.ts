import { html, render } from "lit";
import type { HistoryEntry } from "./types.js";

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

export function renderHistory(
  container: HTMLElement,
  history: HistoryEntry[],
): void {
  render(
    history.length
      ? html`<div class="nc-card nc-history">
          ${history.map(
            (item) =>
              html`<div class="nc-history-item">
                <div class="nc-history-time">${formatTime(item.timestamp)}</div>
                <div class="nc-history-type">
                  ${item.alert_name || ""} · ${item.type || ""}
                </div>
                <div class="nc-history-message">
                  ${item.message || ""}
                  ${item.details && Object.keys(item.details).length
                    ? html`<div class="nc-details">
                        ${JSON.stringify(item.details, null, 2)}
                      </div>`
                    : ""}
                </div>
              </div>`,
          )}
        </div>`
      : html`<div class="nc-card nc-empty">
          <h2>No activity yet</h2>
          <p>Notification activity and debug traces will appear here.</p>
        </div>`,
    container,
  );
}
