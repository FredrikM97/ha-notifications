import { describe, expect, it, vi } from "vitest";
import {
  getAlerts,
  getYaml,
  saveAlert,
  saveYaml,
  testAlert,
  validateYaml,
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

  it("uses yaml as the YAML route payload key", async () => {
    const client = hass();

    await getYaml(client.hass);
    await validateYaml(client.hass, "alerts: []");
    await saveYaml(client.hass, "alerts: []");

    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(1, {
      type: "ha_notifications/get_yaml",
    });
    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(2, {
      type: "ha_notifications/validate_yaml",
      yaml: "alerts: []",
    });
    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(3, {
      type: "ha_notifications/save_yaml",
      yaml: "alerts: []",
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