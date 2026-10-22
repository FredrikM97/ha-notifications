import {
  errorCause,
  errorMessage,
  isAdmin,
  request,
  requestApi,
  requestWebsocket,
} from "./api.js";
import type {
  Alert,
  AutomationChanges,
  ConfigurationSaveResult,
  HaConfig,
  Hass,
} from "./types.js";

const ID_PREFIX = "ha_notifications_";
const LOAD_TIMEOUT_MS = 10_000;
const LOAD_POLL_MS = 250;
const operations = new WeakMap<Hass["callWS"], Promise<unknown>>();

interface AutomationState {
  entity_id: string;
  state: string;
  attributes: { id?: string };
}

// Panel, cards and YAML views share one mutation queue per HA connection.
function serialize<Result>(
  hass: Hass,
  operation: () => Promise<Result>,
): Promise<Result> {
  const previous = operations.get(hass.callWS) ?? Promise.resolve();
  const pending = previous.then(
    () => executeAsAdmin(hass, operation),
    () => executeAsAdmin(hass, operation),
  );
  operations.set(hass.callWS, pending);
  return pending;
}

async function executeAsAdmin<Result>(
  hass: Hass,
  operation: () => Promise<Result>,
): Promise<Result> {
  if (!isAdmin(hass)) {
    throw new Error("Administrator access is required to manage automations.");
  }
  return operation();
}

export function reloadAutomations(hass: Hass): Promise<void> {
  return serialize(hass, async () => {
    const changes = await request<AutomationChanges>(hass, "get_automations");
    await applyAutomations(hass, changes, true);
  });
}

export function saveConfiguration(
  hass: Hass,
  config: Record<string, unknown>,
): Promise<ConfigurationSaveResult> {
  return serialize(hass, () => saveAndApply(hass, "save_config", { config }));
}

export function saveAlert(hass: Hass, alert: Alert): Promise<Alert> {
  return serialize(hass, async () => {
    const result = await saveAndApply(hass, "save_config", { alert });
    const saved = result.config.alerts.find(({ id }) => id === alert.id);
    if (!saved) {
      throw new Error(
        `ha_notifications/save_config: saved alert ${alert.id} was not returned.`,
      );
    }
    return saved;
  });
}

export function deleteAlert(
  hass: Hass,
  alertId: string,
): Promise<ConfigurationSaveResult> {
  return serialize(hass, () =>
    saveAndApply(hass, "delete", { alert_id: alertId }),
  );
}

async function saveAndApply(
  hass: Hass,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<ConfigurationSaveResult> {
  const result = await request<ConfigurationSaveResult>(
    hass,
    endpoint,
    payload,
  );
  if (!result.saved) {
    throw new Error("Configuration was not saved.");
  }
  try {
    await applyAutomations(hass, result.automation_changes);
  } catch (error) {
    throw new Error(
      "Configuration was saved, but the automation API update failed. " +
        "Retry the save or use Reload in the YAML editor. " +
        errorMessage(error),
      { cause: error },
    );
  }
  return result;
}

function automationEndpoint(id: string): string {
  return `config/automation/config/${encodeURIComponent(id)}`;
}

async function readAutomation(
  hass: Hass,
  id: string,
): Promise<HaConfig | null> {
  try {
    return await requestApi<HaConfig>(hass, "GET", automationEndpoint(id));
  } catch (error) {
    if (errorCause(error).status_code === 404) return null;
    throw error;
  }
}

async function applyAutomations(
  hass: Hass,
  changes: AutomationChanges,
  reloadUnchanged = false,
): Promise<void> {
  const desired = new Map<string, HaConfig>();
  for (const automation of changes.upsert) {
    const id = automation.id;
    if (
      typeof id !== "string" ||
      !id.startsWith(ID_PREFIX) ||
      id.length === ID_PREFIX.length ||
      desired.has(id) ||
      automation.description !== changes.description
    ) {
      throw new Error(
        "Generated automations must have unique managed IDs and an ownership marker.",
      );
    }
    desired.set(id, automation);
  }

  const deletions = new Set(changes.delete);
  for (const id of deletions) {
    if (
      !id.startsWith(ID_PREFIX) ||
      id.length === ID_PREFIX.length ||
      desired.has(id)
    ) {
      throw new Error(
        "Automation deletions must reference distinct managed IDs.",
      );
    }
  }
  const ids = [...desired.keys(), ...deletions];
  const current = new Map<string, HaConfig | null>();
  // Preflight every desired ID, including automations that failed to load.
  for (const id of ids) {
    const document = await readAutomation(hass, id);
    if (
      document &&
      desired.has(id) &&
      document.description !== changes.description
    ) {
      throw new Error(
        `Automation ${id} is not owned by HA Notifications; refusing to update it.`,
      );
    }
    current.set(id, document);
  }
  for (const [id, automation] of desired) {
    if (!sameJson(current.get(id), automation)) {
      await requestApi(hass, "POST", automationEndpoint(id), automation);
    } else if (reloadUnchanged) {
      await requestWebsocket(hass, "call_service", {
        domain: "automation",
        service: "reload",
        service_data: { id },
      });
    }
  }
  for (const [id, document] of current) {
    if (deletions.has(id) && document?.description === changes.description) {
      await requestApi(hass, "DELETE", automationEndpoint(id));
    }
    await waitForAutomations(hass, desired);
  }

  async function waitForAutomations(
    hass: Hass,
    desired: Map<string, HaConfig>,
  ): Promise<void> {
    const pending = new Map(desired);
    if (pending.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Home Assistant did not load the expected automation configuration within 10 seconds: ${[...pending.keys()].join(", ")}. ` +
                "Check Home Assistant logs and its standard automation configuration, then retry YAML > Reload.",
            ),
          ),
        LOAD_TIMEOUT_MS,
      );
    });
    try {
      while (pending.size > 0) {
        const states = await Promise.race([
          requestWebsocket<AutomationState[]>(hass, "get_states"),
          timeout,
        ]);
        for (const [id, document] of pending) {
          const state = states.find(
            (item) =>
              item.entity_id.startsWith("automation.") &&
              item.attributes.id === id &&
              (item.state === "on" || item.state === "off"),
          );
          if (!state) continue;
          let loaded: { config: HaConfig };
          try {
            loaded = await Promise.race([
              request<{ config: HaConfig }>(hass, "automation/config", {
                entity_id: state.entity_id,
              }),
              timeout,
            ]);
          } catch (error) {
            // The entity can disappear between the state snapshot and its reload.
            if (errorCause(error).code === "not_found") continue;
            throw error;
          }
          if (sameJson(loaded.config, document)) pending.delete(id);
        }
        if (pending.size === 0) return;
        await Promise.race([
          new Promise((resolve) => {
            pollTimer = setTimeout(resolve, LOAD_POLL_MS);
          }),
          timeout,
        ]);
      }
    } finally {
      clearTimeout(timer);
      clearTimeout(pollTimer);
    }
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}
