import type {
  Alert,
  Hass,
  HistoryEntry,
  Registries,
  RegistryArea,
  RegistryDevice,
  RegistryEntity,
  RegistryFloor,
  RegistryLabel,
  RegistryState,
  RegistryUser,
  RuntimeAlertState,
} from "./types.js";

const DOMAIN = "ha_notifications";

export interface PreviewSessionResult {
  session_id: string;
}

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
  command: string,
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
  const alerts = await call<unknown>(hass, "list");
  if (!Array.isArray(alerts)) {
    throw new Error("ha_notifications/list: expected an alert list.");
  }

  return alerts as Alert[];
}

export async function getAlertRuntime(
  hass: Hass,
): Promise<Record<string, RuntimeAlertState>> {
  const runtime = await call<unknown>(hass, "runtime");
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new Error("ha_notifications/runtime: expected a runtime mapping.");
  }

  return runtime as Record<string, RuntimeAlertState>;
}

export async function saveAlert(hass: Hass, alert: Alert): Promise<Alert> {
  if (!alert.id || typeof alert.id !== "string") {
    throw new Error("ha_notifications/save: alert.id is required.");
  }
  return call<Alert>(hass, "save", {
    alert,
  });
}

export async function deleteAlert(
  hass: Hass,
  alertId: string,
): Promise<unknown> {
  return call(hass, "delete", {
    alert_id: alertId,
  });
}

export async function previewAlert(hass: Hass, alertId: string): Promise<unknown> {
  if (!alertId) {
    throw new Error("Select an alert before testing it.");
  }

  return call(hass, "preview", {
    alert_id: alertId,
  });
}

export async function previewAlertPayload(
  hass: Hass,
  alert: Alert,
): Promise<PreviewSessionResult> {
  return call<PreviewSessionResult>(hass, "preview_payload", { alert });
}

export async function validateConditions(
  hass: Hass,
  alert: Alert,
): Promise<unknown> {
  return call(hass, "validate_conditions", { alert });
}

export async function discardPreview(
  hass: Hass,
  sessionId: string,
): Promise<unknown> {
  return call(hass, "discard_preview", { session_id: sessionId });
}

export async function getHistory(
  hass: Hass,
  alertId: string | null = null,
  limit = 100,
) {
  const data: Record<string, unknown> = { limit };
  if (alertId) {
    data.alert_id = alertId;
  }

  return call<HistoryEntry[]>(hass, "history", data);
}

export async function getConfig(
  hass: Hass,
): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>(hass, "get_config");
}

export async function validateConfig(
  hass: Hass,
  config: Record<string, unknown>,
): Promise<unknown> {
  return call(hass, "validate_config", {
    config,
  });
}

export async function saveConfig(
  hass: Hass,
  config: Record<string, unknown>,
): Promise<{ saved: boolean; config: Record<string, unknown> }> {
  return call<{ saved: boolean; config: Record<string, unknown> }>(
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
