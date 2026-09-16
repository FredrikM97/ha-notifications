import { describe, expect, it, vi } from "vitest";
import {
  getAlerts,
  getAlertRuntime,
  getConfig,
  saveAlert,
  saveConfig,
  testAlert,
  validateConfig,
} from "../../frontend/api.js";
import type { Alert, Hass } from "../../frontend/types.js";

function hass() {
  const sendMessagePromise = vi.fn().mockResolvedValue({});
  return {
    hass: { connection: { sendMessagePromise } } as Hass,
    sendMessagePromise,
  };
}

describe("frontend API transport", () => {
  it("uses the runtime command for alert runtime state", async () => {
    const client = hass();
    const runtime = { door: { active: true } };
    client.sendMessagePromise.mockResolvedValueOnce(runtime);

    await expect(getAlertRuntime(client.hass)).resolves.toEqual(runtime);

    expect(client.sendMessagePromise).toHaveBeenCalledWith({
      type: "ha_notifications/runtime",
    });
  });

  it("namespaces alert list and save commands", async () => {
    const client = hass();
    const alert = { id: "door", name: "Door" } as Alert;
    client.sendMessagePromise.mockResolvedValueOnce([]);

    await getAlerts(client.hass);
    await saveAlert(client.hass, alert);

    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(1, {
      type: "ha_notifications/list",
    });
    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(2, {
      type: "ha_notifications/save",
      alert,
    });
  });

  it("uses structured config for configuration routes", async () => {
    const client = hass();
    const config = { version: 1, alerts: [] };

    await getConfig(client.hass);
    await validateConfig(client.hass, config);
    await saveConfig(client.hass, config);

    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(1, {
      type: "ha_notifications/get_config",
    });
    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(2, {
      type: "ha_notifications/validate_config",
      config,
    });
    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(3, {
      type: "ha_notifications/save_config",
      config,
    });
  });

  it("does not send a test command without an alert id", async () => {
    const client = hass();

    await expect(testAlert(client.hass, "")).rejects.toThrow(
      "Select an alert before testing it.",
    );
    expect(client.sendMessagePromise).not.toHaveBeenCalled();
  });

  it("rejects a malformed alert list instead of clearing the dashboard", async () => {
    const client = hass();
    client.sendMessagePromise.mockResolvedValueOnce({ alerts: [] });

    await expect(getAlerts(client.hass)).rejects.toThrow(
      "ha_notifications/list: expected an alert list.",
    );
  });
});