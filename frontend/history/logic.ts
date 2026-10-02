import type { RuntimeAlertHistoryEntry } from "../types.js";

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