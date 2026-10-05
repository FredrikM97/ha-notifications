import { describe, expect, expectTypeOf, it } from "vitest";
import { defaultAlert } from "../../frontend/editor/alert-model.js";
import type { Alert, AlertsConfig, MonitorConfig } from "../../frontend/types.js";

const canonicalAlert = {
  id: "door",
  name: "Front door",
  enabled: true,
  monitor: {
    automation_mode: "parallel",
    triggers: { enabled: true, items: [{ trigger: "homeassistant", event: "start" }] },
    conditions: {
      enabled: true,
      items: [
        { condition: "and", conditions: [{ condition: "state" }] },
        { condition: "template", value_template: "{{ is_state(...) }}" },
        { condition: "device", device_id: "front-door" },
      ],
      startup: false,
      periodic: false,
    },
    inactive: { enabled: false, items: [], clear_notification: false },
  },
  notification: {
    action: "notify.mobile_app_phone",
    target: { entity_id: ["notify.phone"] },
    data: { message: "Open" },
  },
} satisfies Alert;

const canonicalConfig = {
  version: 1,
  alerts: [canonicalAlert],
} satisfies AlertsConfig;

describe("canonical frontend configuration types", () => {
  it("includes explicit inactive configuration and monitor automation mode", () => {
    expectTypeOf<keyof MonitorConfig>().toEqualTypeOf<"automation_mode" | "triggers" | "conditions" | "inactive">();
    expectTypeOf<MonitorConfig["automation_mode"]>().toEqualTypeOf<"single" | "restart" | "queued" | "parallel">();
    const monitor: MonitorConfig = defaultAlert().monitor;
    expect(monitor).toMatchSnapshot();
  });

  it("snapshots the canonical versioned alert contract", () => {
    expect(canonicalConfig).toMatchSnapshot();
  });
});