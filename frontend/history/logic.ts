import type { RuntimeAlertHistoryEntry } from "../types.js";

export interface HistoryFilters {
  search: string;
  alertId: string;
  type: string;
  severity: string;
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
      item.state?.flow_id,
      historyDetailSummary(item.event?.details),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes(search);
  });
}