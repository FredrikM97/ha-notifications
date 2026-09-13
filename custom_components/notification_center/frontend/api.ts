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
  RegistryUser,
} from "./types.js";

const DOMAIN = "notification_center";

export interface DraftTestResult {
  session_id: string;
  confirmation_action_id: string | null;
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
  return hass.connection.sendMessagePromise<T>({
    type: `${DOMAIN}/${command}`,
    ...data,
  });
}

async function callRegistry<T>(hass: Hass, type: string): Promise<T[]> {
  const result = await hass.connection.sendMessagePromise<T[]>({ type });
  return Array.isArray(result) ? result : [];
}

export async function loadRegistries(hass: Hass): Promise<Registries> {
  const [entities, devices, areas, labels, floors, users] = await Promise.all([
    callRegistry<RegistryEntity>(hass, "config/entity_registry/list"),
    callRegistry<RegistryDevice>(hass, "config/device_registry/list"),
    callRegistry<RegistryArea>(hass, "config/area_registry/list"),
    callRegistry<RegistryLabel>(hass, "config/label_registry/list"),
    callRegistry<RegistryFloor>(hass, "config/floor_registry/list"),
    callRegistry<RegistryUser>(hass, "config/auth/list"),
  ]);

  return {
    entities,
    devices,
    areas,
    labels,
    floors,
    users,
  };
}

export async function getAlerts(hass: Hass): Promise<Alert[]> {
  return call<Alert[]>(hass, "list");
}

export async function saveAlert(hass: Hass, alert: Alert): Promise<Alert> {
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

export async function testAlert(hass: Hass, alertId: string): Promise<unknown> {
  return call(hass, "test", {
    alert_id: alertId,
  });
}

export async function testAlertPayload(
  hass: Hass,
  alert: Alert,
): Promise<DraftTestResult> {
  return call<DraftTestResult>(hass, "test_payload", { alert });
}

export async function discardDraftTestPayload(
  hass: Hass,
  sessionId: string,
): Promise<unknown> {
  return call(hass, "discard_test_payload", { session_id: sessionId });
}

export async function getHistory(
  hass: Hass,
  alertId: string | null = null,
  limit = 100,
) {
  return call<HistoryEntry[]>(hass, "history", {
    ...(alertId ? { alert_id: alertId } : {}),
    limit,
  });
}

export async function getYaml(hass: Hass): Promise<{ yaml: string }> {
  return call<{ yaml: string }>(hass, "get_yaml");
}

export async function validateYaml(hass: Hass, yaml: string): Promise<unknown> {
  return call(hass, "validate_yaml", {
    yaml,
  });
}

export async function saveYaml(
  hass: Hass,
  yaml: string,
): Promise<{ saved: boolean; config: Record<string, unknown> }> {
  return call<{ saved: boolean; config: Record<string, unknown> }>(
    hass,
    "save_yaml",
    {
      yaml,
    },
  );
}

export async function reload(hass: Hass): Promise<unknown> {
  return call(hass, "reload");
}
