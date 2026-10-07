import { describe, expect, it, vi } from "vitest";
import type { Hass } from "../../frontend/types.js";
import { errorMessage, request } from "../../frontend/api.js";
import { createHassClient, homeAssistantFixture } from "./conftest.js";

describe("frontend API transport", () => {
  it("sends a caller-defined endpoint request and protects its message type", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce({ cancelled: true });
    const payload = { alert_id: "door", type: "other/command" };

    await expect(request(client.hass, "cancel_run", payload)).resolves.toEqual({ cancelled: true });
    expect(client.callWS).toHaveBeenCalledExactlyOnceWith({
      alert_id: "door",
      type: "ha_notifications/cancel_run",
    });
    expect(payload.type).toBe("other/command");
  });

  it("allows requests without a payload", async () => {
    const client = createHassClient();
    await request(client.hass, "get_history");
    expect(client.callWS).toHaveBeenCalledExactlyOnceWith({
      type: "ha_notifications/get_history",
    });
  });

  it("passes arbitrary payloads and responses through without a registry", async () => {
    const client = createHassClient();
    const response = { results: ["door"], cursor: null };
    const payload = { query: { enabled: true }, limit: 10 };
    client.sendMessagePromise.mockResolvedValueOnce(response);

    expect(await request<typeof response>(client.hass, "search_alerts", payload)).toBe(response);
    expect(client.callWS).toHaveBeenCalledExactlyOnceWith({
      ...payload,
      type: "ha_notifications/search_alerts",
    });
  });

  it("preserves fully qualified endpoints for other APIs", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce(undefined);

    await expect(request(client.hass, "other/action", { enabled: true })).resolves.toBeUndefined();
    expect(client.callWS).toHaveBeenCalledExactlyOnceWith({
      enabled: true,
      type: "other/action",
    });
  });

  it.each([
    { response: undefined },
    { response: null },
    { response: false },
    { response: 0 },
    { response: "ok" },
    { response: ["door"] },
  ])("returns $response unchanged", async ({ response }) => {
    const client = createHassClient();
    client.sendMessagePromise.mockResolvedValueOnce(response);
    expect(await request(client.hass, "action")).toBe(response);
  });

  it.each([
    { error: new Error("Not found"), message: "Not found" },
    { error: { error: { message: "Not found" } }, message: "Not found" },
    { error: { details: { message: "Invalid" } }, message: "Invalid" },
    { error: { message: "Unavailable" }, message: "Unavailable" },
    { error: "Disconnected", message: "Disconnected" },
  ])("reports transport errors with the endpoint: $message", async ({ error, message }) => {
    const client = createHassClient();
    client.sendMessagePromise.mockRejectedValueOnce(error);
    await expect(request(client.hass, "cancel_run", { alert_id: "door" })).rejects.toThrow(
      `ha_notifications/cancel_run: ${message}`,
    );
    expect(errorMessage(error)).toBe(message);
  });

  it("keeps fully qualified endpoint names in errors", async () => {
    const client = createHassClient();
    client.sendMessagePromise.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(request(client.hass, "config/auth/list")).rejects.toThrow("config/auth/list: Forbidden");
  });

  it("uses an overridden callWS without accessing the connection transport", async () => {
    const client = createHassClient();
    const response = { id: "server_draft" };
    const callWS = vi.fn().mockResolvedValue(response);
    const hass = homeAssistantFixture({ connection: client.hass.connection, callWS });

    expect(await request(hass, "alert_defaults")).toBe(response);
    expect(callWS).toHaveBeenCalledExactlyOnceWith({ type: "ha_notifications/alert_defaults" });
    expect(client.sendMessagePromise).not.toHaveBeenCalled();
  });

  it("delegates fixture callWS to the supplied connection", async () => {
    const client = createHassClient();
    const response = { valid: true };
    client.sendMessagePromise.mockResolvedValueOnce(response);
    const hass = homeAssistantFixture({ connection: client.hass.connection });

    expect(await request(hass, "validate_config", { config: { alerts: [] } })).toBe(response);
    expect(client.sendMessagePromise).toHaveBeenCalledExactlyOnceWith({
      type: "ha_notifications/validate_config", config: { alerts: [] },
    });
  });

  it("does not fall back to connection transport when callWS is unavailable", async () => {
    const client = createHassClient();
    const hass = { connection: client.hass.connection } as Hass;

    await expect(request(hass, "alert_defaults")).rejects.toThrow("ha_notifications/alert_defaults:");
    expect(client.sendMessagePromise).not.toHaveBeenCalled();
  });
});