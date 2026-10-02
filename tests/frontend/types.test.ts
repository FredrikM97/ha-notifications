import { describe, expect, it } from "vitest";
import type { AlertsConfig, CanonicalAlert } from "../../frontend/types.js";

const canonicalAlert = {
  id: "door",
  name: "Front door",
  enabled: true,
  triggers: [{ trigger: "homeassistant", event: "start" }],
  conditions: [
    { condition: "and", conditions: [{ condition: "state" }] },
    { condition: "template", value_template: "{{ is_state(...) }}" },
    { condition: "device", device_id: "front-door" },
  ],
  notification: {
    action: "notify.mobile_app_phone",
    target: { entity_id: ["notify.phone"] },
    data: { message: "Open" },
  },
  recovery: {
    clear: true,
    notification: {
      action: "notify.mobile_app_phone",
      data: { message: "Closed" },
    },
  },
  automation: { id: "automation.door", ownership: "managed", status: "on" },
} satisfies CanonicalAlert;

const canonicalConfig = {
  version: 1,
  alerts: [canonicalAlert],
} satisfies AlertsConfig;

describe("canonical frontend configuration types", () => {
  it("snapshots the canonical versioned alert contract", () => {
    expect(canonicalConfig).toMatchSnapshot();
  });
});