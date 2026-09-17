import { describe, expect, it } from "vitest";
import {
  getAlerts,
  getAlertRuntime,
  getConfig,
  saveAlert,
  saveConfig,
  testAlert,
  validateConfig,
} from "../../frontend/api.js";
import { alertFixture, createHassClient } from "./conftest.js";

describe("frontend API transport", () => {
  it("uses the runtime command for alert runtime state", async () => {
    const client = createHassClient();
    const runtime = { door: { active: true } };
    client.sendMessagePromise.mockResolvedValueOnce(runtime);

    const result = await getAlertRuntime(client.hass);

    expect({
      result,
      calls: client.sendMessagePromise.mock.calls,
    }).toMatchSnapshot();
  });

  it("namespaces alert list and save commands", async () => {
    const client = createHassClient();
    const alert = alertFixture();
    client.sendMessagePromise.mockResolvedValueOnce([]);

    await getAlerts(client.hass);
    await saveAlert(client.hass, alert);

    expect(client.sendMessagePromise.mock.calls).toMatchSnapshot();
  });

  it("uses structured config for configuration routes", async () => {
    const client = createHassClient();
    const config = { version: 1, alerts: [] };

    await getConfig(client.hass);
    await validateConfig(client.hass, config);
    await saveConfig(client.hass, config);

    expect(client.sendMessagePromise.mock.calls).toMatchSnapshot();
  });

  it("does not send a test command without an alert id", async () => {
    const client = createHassClient();

    await expect(testAlert(client.hass, "")).rejects.toThrow(
      "Select an alert before testing it.",
    );
    expect(client.sendMessagePromise).not.toHaveBeenCalled();
  });

  it("rejects a malformed alert list instead of clearing the dashboard", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce({ alerts: [] });

    await expect(getAlerts(client.hass)).rejects.toThrow(
      "ha_notifications/list: expected an alert list.",
    );
  });
});