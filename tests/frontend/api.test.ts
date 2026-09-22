import { describe, expect, it } from "vitest";
import {
  getAlerts,
  getAlertRuntime,
  getConfig,
  getHistory,
  deleteAlert,
  loadRegistries,
  reload,
  saveAlert,
  saveConfig,
  previewAlertPayload,
  validateConfig,
} from "../../frontend/api.js";
import {
  alertFixture,
  configFixture,
  createHassClient,
  previewSessionResultFixture,
} from "./conftest.js";

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
    const config = configFixture;

    await getConfig(client.hass);
    await validateConfig(client.hass, config);
    await saveConfig(client.hass, config);

    expect(client.sendMessagePromise.mock.calls).toMatchSnapshot();
  });

  it("rejects a malformed alert list instead of clearing the dashboard", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce({ alerts: [] });

    await expect(getAlerts(client.hass)).rejects.toThrow(
      "ha_notifications/list: expected an alert list.",
    );
  });

  it("snapshots history, delete, draft test, and reload commands", async () => {
    const client = createHassClient();
    const alert = alertFixture();

    await getHistory(client.hass, "door", 150);
    await deleteAlert(client.hass, "door");
    client.sendMessagePromise.mockResolvedValueOnce(previewSessionResultFixture);
    await previewAlertPayload(client.hass, alert);
    await reload(client.hass);

    expect(client.sendMessagePromise.mock.calls).toMatchSnapshot();
  });

  it("enriches registry entities with friendly state names", async () => {
    const client = createHassClient();
    client.sendMessagePromise
      .mockResolvedValueOnce([{ entity_id: "light.kitchen" }])
      .mockResolvedValueOnce([
        { entity_id: "light.kitchen", attributes: { friendly_name: "Kitchen" } },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(loadRegistries(client.hass)).resolves.toMatchObject({
      entities: [{ entity_id: "light.kitchen", friendly_name: "Kitchen" }],
    });
  });
});