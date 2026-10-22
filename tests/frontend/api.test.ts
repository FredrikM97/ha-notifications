import { describe, expect, it, vi } from "vitest";
import type { Hass } from "../../frontend/types.js";
import {
  errorCause,
  errorMessage,
  isAdmin,
  request,
  requestApi,
  requestWebsocket,
} from "../../frontend/api.js";
import { createHassClient, homeAssistantFixture } from "./conftest.js";

describe("frontend API transport", () => {
  it("preserves native websocket command names without the integration namespace", async () => {
    const client = createHassClient();
    client.callWS.mockResolvedValueOnce([]);
    await expect(requestWebsocket(client.hass, "get_states", { type: "wrong" })).resolves.toEqual([]);
    expect(client.callWS).toHaveBeenCalledExactlyOnceWith({ type: "get_states" });
  });

  it("sends a caller-defined endpoint request and protects its message type", async () => {
    const client = createHassClient();
    client.callWS.mockResolvedValueOnce({ cancelled: true });
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
    client.callWS.mockResolvedValueOnce(response);

    expect(await request<typeof response>(client.hass, "search_alerts", payload)).toBe(response);
    expect(client.callWS).toHaveBeenCalledExactlyOnceWith({
      ...payload,
      type: "ha_notifications/search_alerts",
    });
  });

  it("preserves fully qualified endpoints for other APIs", async () => {
    const client = createHassClient();
    client.callWS.mockResolvedValueOnce(undefined);

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
    client.callWS.mockResolvedValueOnce(response);
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
    client.callWS.mockRejectedValue(error);
    await expect(request(client.hass, "cancel_run", { alert_id: "door" })).rejects.toThrow(
      `ha_notifications/cancel_run: ${message}`,
    );
    await expect(request(client.hass, "cancel_run")).rejects.toHaveProperty("cause", error);
    expect(errorMessage(error)).toBe(message);
  });

  it("keeps fully qualified endpoint names in errors", async () => {
    const client = createHassClient();
    client.callWS.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(request(client.hass, "config/auth/list")).rejects.toThrow("config/auth/list: Forbidden");
  });

  it("uses an overridden callWS directly", async () => {
    const response = { valid: true };
    const callWS = vi.fn().mockResolvedValue(response);
    const hass = homeAssistantFixture({ callWS });

    expect(hass.callWS).toBe(callWS);
    expect(await request(hass, "validate_config")).toBe(response);
    expect(callWS).toHaveBeenCalledExactlyOnceWith({ type: "ha_notifications/validate_config" });
  });

  it("uses the supplied client callWS at the fixture API boundary", async () => {
    const client = createHassClient();
    const response = { valid: true };
    client.callWS.mockResolvedValueOnce(response);
    const hass = homeAssistantFixture({ callWS: client.callWS });

    expect(await request(hass, "validate_config", { config: { alerts: [] } })).toBe(response);
    expect(client.callWS).toHaveBeenCalledExactlyOnceWith({
      type: "ha_notifications/validate_config", config: { alerts: [] },
    });
  });

  it("reports the endpoint when callWS is unavailable", async () => {
    const hass = {} as Hass;

    await expect(request(hass, "validate_config")).rejects.toThrow("ha_notifications/validate_config:");
  });

  it("uses Home Assistant's API transport and reports its endpoint on errors", async () => {
    const client = createHassClient();
    const response = { id: "door" };
    client.callApi.mockResolvedValueOnce(response);

    await expect(requestApi(client.hass, "GET", "config/automation/config/door")).resolves.toBe(response);
    expect(client.callApi).toHaveBeenCalledExactlyOnceWith(
      "GET",
      "config/automation/config/door",
      undefined,
    );

    client.callApi.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(requestApi(client.hass, "DELETE", "config/automation/config/door"))
      .rejects.toThrow("DELETE config/automation/config/door: Forbidden");
  });

  it("preserves structured API errors for callers that handle specific status codes", async () => {
    const client = createHassClient();
    const cause = { status_code: 404, body: { message: "Resource not found" } };
    client.callApi.mockRejectedValueOnce(cause);
    await expect(requestApi(client.hass, "GET", "config/automation/config/missing"))
      .rejects.toMatchObject({
        message: "GET config/automation/config/missing: Resource not found",
        cause,
      });
  });

  it("exposes wrapped transport causes for status-specific handling", async () => {
    const client = createHassClient();
    client.callApi.mockRejectedValueOnce({ status_code: 404 });
    const error = await requestApi(client.hass, "GET", "config/automation/config/x").catch(e => e);

    expect(errorCause(error).status_code).toBe(404);
    expect(errorCause(new Error("plain"))).toEqual({});
    expect(errorCause("text")).toEqual({});
  });

  it("treats only explicit administrators as admins", () => {
    expect(isAdmin(homeAssistantFixture())).toBe(true);
    expect(isAdmin(homeAssistantFixture({ user: { is_admin: false } }))).toBe(false);
    expect(isAdmin(homeAssistantFixture({ user: undefined }))).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});
