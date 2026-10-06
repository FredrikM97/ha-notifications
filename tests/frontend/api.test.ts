import { describe, expect, it } from "vitest";
import {
  cancelRun,
  getAlerts,
  getAutomationStatus,
  getConfig,
  getHistory,
  deleteAlert,
  loadUsers,
  reload,
  saveAlert,
  saveConfig,
  testAlert,
  validateAlert,
  validateConfig,
} from "../../frontend/api.js";
import type { Alert, AlertsConfig } from "../../frontend/types.js";
import {
  alertFixture,
  configFixture,
  createHassClient,
  editorAlertFixture,
} from "./conftest.js";

describe("frontend API transport", () => {
  it("starts a saved alert test by alert id without trigger data", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce({ started: true });

    await expect(testAlert(client.hass, "door")).resolves.toEqual({ started: true });
    expect(client.sendMessagePromise).toHaveBeenCalledExactlyOnceWith({
      type: "ha_notifications/test_alert",
      alert_id: "door",
    });
  });

  it("cancels active automation runs by alert id", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce({ cancelled: true });

    await expect(cancelRun(client.hass, "door")).resolves.toEqual({ cancelled: true });
    expect(client.sendMessagePromise).toHaveBeenCalledWith({
      type: "ha_notifications/cancel_run",
      alert_id: "door",
    });
  });

  it("loads history through the namespaced history command", async () => {
    const client = createHassClient();
    const history = [{
      config: { id: "door", name: "Door" },
      event: {
        event_id: "event-1",
        timestamp: "2026-09-29T12:00:00+00:00",
        type: "notification_sent",
        message: "Notification sent",
        details: {},
      },
    }];
    client.sendMessagePromise.mockResolvedValueOnce(history);

    await expect(getHistory(client.hass, "door")).resolves.toEqual(history);
    expect(client.sendMessagePromise).toHaveBeenCalledWith({
      type: "ha_notifications/get_history",
      alert_id: "door",
    });
  });

  it("gets automation status by alert id", async () => {
    const client = createHassClient();
    const status = {
      door: "managed",
      window: "manual",
      missing_alert: "missing",
      disabled_alert: "disabled",
    } as const;
    client.sendMessagePromise.mockResolvedValueOnce(status);

    await expect(getAutomationStatus(client.hass)).resolves.toEqual(status);
    expect(client.sendMessagePromise).toHaveBeenCalledWith({
      type: "ha_notifications/automation_status",
    });
  });

  it("gets alerts from canonical config and namespaces save commands", async () => {
    const client = createHassClient();
    const alert = alertFixture({
      conditions: [{ condition: "template", value_template: "{{ true }}" }],
      triggers: [{ trigger: "state", entity_id: "binary_sensor.front_door" }],
      notification: {
        action: "notify.phone",
        target: { entity_id: ["notify.phone"] },
        title: "", message: "", options: {  },
      },
    });
    client.sendMessagePromise
      .mockResolvedValueOnce({ version: 1, alerts: [alert] })
      .mockResolvedValueOnce({ version: 1, alerts: [alert] })
      .mockResolvedValueOnce({ saved: true, config: { version: 1, alerts: [alert] } });

    await expect(getAlerts(client.hass)).resolves.toEqual([alert]);
    await expect(saveAlert(client.hass, alert)).resolves.toEqual(alert);

    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(1, {
      type: "ha_notifications/get_config",
    });
    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(2, {
      type: "ha_notifications/get_config",
    });
    expect(client.sendMessagePromise).toHaveBeenNthCalledWith(3, {
      type: "ha_notifications/save_config",
      config: { version: 1, alerts: [alert] },
    });
    expect(client.sendMessagePromise.mock.calls.map(([request]) => request.type)).not.toContain(
      "ha_notifications/save",
    );
  });

  it("serializes durations for every alert transport endpoint", async () => {
    const client = createHassClient();
    const alert = editorAlertFixture();
    alert.confirmation!.reminders.timeout = "00:15:00";
    client.sendMessagePromise
      .mockResolvedValueOnce({ version: 1, alerts: [] })
      .mockResolvedValueOnce({ saved: true, config: { version: 1, alerts: [alert] } })
      .mockResolvedValueOnce({ version: 1, alerts: [] });

    await saveAlert(client.hass, alert);
    await validateAlert(client.hass, alert);

    expect(client.sendMessagePromise.mock.calls.map(([request]) => request.type)).toEqual([
      "ha_notifications/get_config",
      "ha_notifications/save_config",
      "ha_notifications/get_config",
      "ha_notifications/validate_config",
    ]);
    const saveRequest = client.sendMessagePromise.mock.calls[1][0] as {
      config: { alerts: Alert[] };
    };
    const savedAlert = saveRequest.config.alerts[0];
    expect(savedAlert.monitor.triggers.items).toEqual(alert.monitor.triggers.items);
    expect(savedAlert.monitor.conditions.items).toEqual([{
      condition: "state",
      entity_id: "binary_sensor.front_door",
      state: "on",
      for: "00:05:00",
    }]);
    expect(savedAlert.notification).toEqual({
      action: "notify.mobile_app_phone",
      target: {
        entity_id: ["notify.phone"],
        device_id: ["device_phone"],
      },
      title: "Front door", message: "The front door is still open.", options: {  },
    });
    expect(savedAlert.confirmation?.reminders.interval).toBe(1800);
    expect(savedAlert.confirmation?.reminders.timeout).toBe(900);

    const validationRequest = client.sendMessagePromise.mock.calls[3][0] as {
      config: { alerts: Record<string, unknown>[] };
    };
    expect(validationRequest.config.alerts[0]).toMatchObject({
      monitor: { conditions: { items: [{
        condition: "state",
        entity_id: "binary_sensor.front_door",
        state: "on",
        for: "00:05:00",
      }] } },
      notification: {
        action: "notify.mobile_app_phone",
        target: {
          entity_id: ["notify.phone"],
          device_id: ["device_phone"],
        },
      },
    });
    expect(validationRequest.config.alerts).toHaveLength(1);
    expect(client.sendMessagePromise.mock.calls.map(([request]) => request.type)).not.toContain(
      "ha_notifications/validate_conditions",
    );
  });

  it("saves canonical confirmation and notification payloads unchanged", async () => {
    const client = createHassClient();
    const alert = editorAlertFixture();
    client.sendMessagePromise
      .mockResolvedValueOnce({ version: 1, alerts: [] })
      .mockResolvedValueOnce({
        saved: true,
        config: { version: 1, alerts: [{ id: alert.id }] },
      });

    await saveAlert(client.hass, alert);

    const request = client.sendMessagePromise.mock.calls[1][0] as {
      config: { alerts: Record<string, unknown>[] };
    };
    const savedAlert = request.config.alerts[0];
    expect(savedAlert).toMatchObject({
      monitor: { conditions: { items: [{
        condition: "state",
        entity_id: "binary_sensor.front_door",
        state: "on",
        for: "00:05:00",
      }] } },
      notification: {
        action: "notify.mobile_app_phone",
        title: "Front door", message: "The front door is still open.", options: {  },
      },
      confirmation: {
        enabled: true,
        buttons: [{ id: "confirm", label: "Close door" }],
        notification: { action: "notify.mobile_app_phone", title: "Front door", message: "Front door closed by {{confirmed_by}}.", options: {  } },
        actions: [{ action: "light.turn_on", target: { entity_id: ["light.hall"] } }],
      },
    });
    expect(savedAlert).toHaveProperty("monitor.conditions.items");
    expect(savedAlert).not.toHaveProperty("runtime");
    expect(savedAlert).toHaveProperty("post_send_actions", {
      enabled: true,
      actions: [{
        action: "logbook.log",
        data: { name: "Front door alert" },
      }],
    });
  });

  it("rejects alerts without an id before transport", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce({ version: 1, alerts: [] });

    await expect(saveAlert(client.hass, editorAlertFixture({ id: "" }))).rejects.toThrow(
      "ha_notifications/save_config: alert.id is required.",
    );
    expect(client.sendMessagePromise).not.toHaveBeenCalled();
  });

  it("uses structured config for configuration routes", async () => {
    const client = createHassClient();
    const config = configFixture as AlertsConfig;

    await getConfig(client.hass);
    await validateConfig(client.hass, config);
    await saveConfig(client.hass, config);

    expect(client.sendMessagePromise.mock.calls).toMatchSnapshot();
  });

  it("rejects malformed canonical config instead of clearing the dashboard", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce({});

    await expect(getAlerts(client.hass)).rejects.toThrow(
      "ha_notifications/get_config: expected canonical configuration with an alerts array.",
    );
  });

  it("reports missing alert deletion through the save config route", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce({ version: 1, alerts: [] });

    await expect(deleteAlert(client.hass, "missing")).rejects.toThrow(
      "ha_notifications/save_config: alert missing was not found.",
    );
    expect(client.sendMessagePromise).toHaveBeenCalledWith({
      type: "ha_notifications/get_config",
    });
    expect(client.sendMessagePromise).toHaveBeenCalledTimes(1);
  });

  it("snapshots delete and reload commands", async () => {
    const client = createHassClient();
    const alert = alertFixture();
    client.sendMessagePromise
      .mockResolvedValueOnce({ version: 1, alerts: [alert] })
      .mockResolvedValueOnce({ saved: true, config: { version: 1, alerts: [] } });

    await deleteAlert(client.hass, "door");
    await reload(client.hass);

    expect(client.sendMessagePromise.mock.calls).toMatchSnapshot();
    expect(client.sendMessagePromise.mock.calls.map(([request]) => request.type)).not.toContain(
      "ha_notifications/delete",
    );
  });

  it("loads active human users for recipient selectors", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce([
      { id: "admin", name: "Admin" },
      { id: "inactive", name: "Inactive", is_active: false },
      { id: "system", name: "System", system_generated: true },
      { id: "operator", name: "Operator", is_active: true },
    ]);

    await expect(loadUsers(client.hass)).resolves.toEqual([
      { value: "admin", label: "Admin" },
      { value: "operator", label: "Operator" },
    ]);
    expect(client.sendMessagePromise).toHaveBeenCalledWith({
      type: "config/auth/list",
    });
  });
});