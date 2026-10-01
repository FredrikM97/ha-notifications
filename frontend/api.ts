import type {
  Alert,
  AlertsConfig,
  AutomationRuntimeStatus,
  AutomationStatusValue,
  Hass,
  Registries,
  RegistryArea,
  RegistryDevice,
  RegistryEntity,
  RegistryFloor,
  RegistryLabel,
  RegistryState,
  RegistryUser,
  RuntimeAlertHistoryEntry,
} from "./types.js";
import { serializeAlertDurations } from "./alert-payload.js";

const DOMAIN = "ha_notifications";
type Command =
  | "get_config"
  | "automation_status"
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

async function callRegistry<T>(hass: Hass, type: string): Promise<T[]> {
  const result = await hass.connection.sendMessagePromise<T[]>({ type });
  if (Array.isArray(result)) {
    return result;
  }

  return [];
}

function toCanonicalAlert(alert: Alert): AlertsConfig["alerts"][number] {
  const serialized = serializeAlertDurations(alert);
  const { runtime: _runtime, ...canonical } = serialized;
  return canonical as AlertsConfig["alerts"][number];
}

export async function loadRegistries(hass: Hass): Promise<Registries> {
  const [entities, states, devices, areas, labels, floors, users] =
    await Promise.all([
      callRegistry<RegistryEntity>(hass, "config/entity_registry/list"),
      callRegistry<RegistryState>(hass, "get_states"),
      callRegistry<RegistryDevice>(hass, "config/device_registry/list"),
      callRegistry<RegistryArea>(hass, "config/area_registry/list"),
      callRegistry<RegistryLabel>(hass, "config/label_registry/list"),
      callRegistry<RegistryFloor>(hass, "config/floor_registry/list"),
      callRegistry<RegistryUser>(hass, "config/auth/list"),
    ]);
  const friendlyNames = new Map(
    states.map((state) => [state.entity_id, state.attributes?.friendly_name]),
  );

  return {
    entities: entities.map((entity) => ({
      ...entity,
      friendly_name:
        friendlyNames.get(entity.entity_id) || entity.friendly_name,
    })),
    devices,
    areas,
    labels,
    floors,
    users,
  };
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
