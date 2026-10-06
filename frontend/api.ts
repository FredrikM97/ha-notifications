import type { Alert, AlertsConfig, AutomationRuntimeStatus, Hass, RuntimeAlertHistoryEntry } from "./types.js";

// ---- Durations (canonical storage is seconds) ----

type DurationValue = string | number | Record<string, number>;

const UNIT_SECONDS: Record<string, number> = { days: 86400, hours: 3600, minutes: 60, seconds: 1 };

export function durationToSeconds(value: DurationValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string") {
    const parts = value.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return undefined;
    if (parts.length === 2) parts.unshift(0);
    if (parts.length !== 3) return undefined;
    return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  if (value && typeof value === "object") {
    return Math.max(
      0,
      Object.entries(UNIT_SECONDS).reduce((sum, [unit, factor]) => sum + (Number(value[unit]) || 0) * factor, 0),
    );
  }
  return undefined;
}

/** Store reminder durations as seconds, the canonical backend form. */
export function serializeAlertDurations(alert: Alert): Alert {
  const result = JSON.parse(JSON.stringify(alert)) as Alert;
  const reminders = result.confirmation?.reminders;
  if (!reminders) return result;
  for (const [key, label] of [
    ["interval", "Confirmation reminder interval"],
    ["timeout", "Confirmation timeout"],
  ] as const) {
    if (reminders[key] === undefined) continue;
    const seconds = durationToSeconds(reminders[key] as DurationValue);
    if (seconds === undefined) throw new Error(`${label} must be a valid duration.`);
    reminders[key] = seconds;
  }
  return result;
}

// ---- Websocket API ----

const DOMAIN = "ha_notifications";
type Command =
  | "get_config"
  | "mobile_platforms"
  | "automation_status"
  | "cancel_run"
  | "test_alert"
  | "get_history"
  | "validate_config"
  | "save_config"
  | "delete"
  | "reload";

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const value = error as Record<string, unknown>;
    const nestedError = value.error as Record<string, unknown> | undefined;
    const details = value.details as Record<string, unknown> | undefined;
    return String(
      nestedError?.message || details?.message || value.message || error,
    );
  }

  return String(error);
}

export async function call<T>(
  hass: Hass,
  command: Command,
  data: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await hass.connection.sendMessagePromise<T>({
      type: `${DOMAIN}/${command}`,
      ...data,
    });
  } catch (error) {
    throw new Error(`${DOMAIN}/${command}: ${errorMessage(error)}`);
  }
}

function toCanonicalAlert(alert: Alert): AlertsConfig["alerts"][number] {
  const serialized = serializeAlertDurations(alert);
  const { runtime: _runtime, ...canonical } = serialized;
  return canonical as AlertsConfig["alerts"][number];
}

/** Active, human users as select options for user recipients. */
export async function loadUsers(hass: Hass): Promise<{ value: string; label: string }[]> {
  const users = await hass.connection.sendMessagePromise<
    { id: string; name: string; is_active?: boolean; system_generated?: boolean }[]
  >({ type: "config/auth/list" });
  return users
    .filter((user) => user.is_active !== false && !user.system_generated)
    .map((user) => ({ value: user.id, label: user.name }));
}

export function getMobilePlatforms(hass: Hass, target: Alert["notification"]["target"]): Promise<{
  platforms: ("android" | "ios")[];
  unknown: boolean;
}> {
  return call(hass, "mobile_platforms", { target });
}

export async function getAlerts(hass: Hass): Promise<Alert[]> {
  const config = await call<unknown>(hass, "get_config");
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(
      "ha_notifications/get_config: expected canonical configuration with an alerts array.",
    );
  }

  const alerts = (config as { alerts?: unknown }).alerts;
  if (!Array.isArray(alerts)) {
    throw new Error(
      "ha_notifications/get_config: expected canonical configuration with an alerts array.",
    );
  }

  return alerts as Alert[];
}

export function getAutomationStatus(
  hass: Hass,
): Promise<Record<string, AutomationRuntimeStatus>> {
  return call<Record<string, AutomationRuntimeStatus>>(hass, "automation_status");
}

export function getHistory(
  hass: Hass,
  alertId?: string,
): Promise<RuntimeAlertHistoryEntry[]> {
  return call<RuntimeAlertHistoryEntry[]>(hass, "get_history", {
    ...(alertId ? { alert_id: alertId } : {}),
  });
}

export function cancelRun(
  hass: Hass,
  alertId: string,
): Promise<{ cancelled: boolean }> {
  return call(hass, "cancel_run", { alert_id: alertId });
}

export function testAlert(
  hass: Hass,
  alertId: string,
): Promise<{ started: true }> {
  return call(hass, "test_alert", { alert_id: alertId });
}

export async function saveAlert(hass: Hass, alert: Alert): Promise<Alert> {
  if (!alert.id || typeof alert.id !== "string") {
    throw new Error("ha_notifications/save_config: alert.id is required.");
  }

  const config = await getConfig(hass);
  const canonicalAlert = toCanonicalAlert(alert);
  const alerts = config.alerts.some(({ id }) => id === alert.id)
    ? config.alerts.map((existingAlert) =>
        existingAlert.id === alert.id ? canonicalAlert : existingAlert,
      )
    : [...config.alerts, canonicalAlert];
  const result = await saveConfig(hass, { ...config, alerts });
  const savedAlert = result.config.alerts.find(({ id }) => id === alert.id);
  if (!savedAlert) {
    throw new Error(`ha_notifications/save_config: saved alert ${alert.id} was not returned.`);
  }

  return savedAlert as unknown as Alert;
}

export async function deleteAlert(
  hass: Hass,
  alertId: string,
): Promise<unknown> {
  const config = await getConfig(hass);
  if (!config.alerts.some(({ id }) => id === alertId)) {
    throw new Error(`ha_notifications/save_config: alert ${alertId} was not found.`);
  }

  return saveConfig(hass, {
    ...config,
    alerts: config.alerts.filter(({ id }) => id !== alertId),
  });
}

export async function getConfig(
  hass: Hass,
): Promise<AlertsConfig> {
  return call<AlertsConfig>(hass, "get_config");
}

export async function validateConfig(
  hass: Hass,
  config: Record<string, unknown>,
): Promise<unknown> {
  return call(hass, "validate_config", {
    config,
  });
}

export async function validateAlert(
  hass: Hass,
  alert: Alert,
): Promise<unknown> {
  const config = await getConfig(hass);
  const canonicalAlert = toCanonicalAlert(alert);
  const alerts = config.alerts.some(({ id }) => id === alert.id)
    ? config.alerts.map((existingAlert) =>
        existingAlert.id === alert.id ? canonicalAlert : existingAlert,
      )
    : [...config.alerts, canonicalAlert];

  return validateConfig(hass, { ...config, alerts });
}

export function saveConfig(
  hass: Hass,
  config: AlertsConfig,
): Promise<{ saved: boolean; config: AlertsConfig }>;
export function saveConfig(
  hass: Hass,
  config: Record<string, unknown>,
): Promise<{ saved: boolean; config: Record<string, unknown> }>;
export async function saveConfig(
  hass: Hass,
  config: AlertsConfig | Record<string, unknown>,
): Promise<{
  saved: boolean;
  config: AlertsConfig | Record<string, unknown>;
}> {
  return call<{ saved: boolean; config: AlertsConfig | Record<string, unknown> }>(
    hass,
    "save_config",
    {
      config,
    },
  );
}

export async function reload(hass: Hass): Promise<unknown> {
  return call(hass, "reload");
}
