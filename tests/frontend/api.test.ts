import { describe, expect, it } from "vitest";
import runtimeContract from "../contracts/runtime.json";
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
  validateConditions,
  validateConfig,
} from "../../frontend/api.js";
import type { Alert } from "../../frontend/types.js";
import {
  alertFixture,
  configFixture,
  createHassClient,
  editorAlertFixture,
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
      request: client.sendMessagePromise.mock.calls[0][0],
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

  it("serializes durations for every alert transport endpoint", async () => {
    const client = createHassClient();
    const alert = editorAlertFixture();
    alert.confirmation!.reminders.timeout = "00:15:00";

    await saveAlert(client.hass, alert);
    await previewAlertPayload(client.hass, alert);
    await validateConditions(client.hass, alert);

    expect(
      client.sendMessagePromise.mock.calls.map(([request]) => request.type),
    ).toEqual([
      "ha_notifications/save",
      "ha_notifications/preview_payload",
      "ha_notifications/validate_conditions",
    ]);
    for (const [request] of client.sendMessagePromise.mock.calls) {
      const payload = request as { alert: Alert };
      expect(payload.alert.monitor.interval).toBe(3600);
      expect(payload.alert.conditions[0].for).toBe(300);
      expect(payload.alert.confirmation?.reminders.interval).toBe(1800);
      expect(payload.alert.confirmation?.reminders.timeout).toBe(900);
    }
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