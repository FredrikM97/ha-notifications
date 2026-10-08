import { describe, expect, expectTypeOf, it } from "vitest";
import { draftAlertFixture } from "./conftest.js";
import type { Alert, AlertsConfig, ConditionConfig, ConfirmationButton, ConfirmationConfig, DurationParts, DurationValue, HaConfig, Hass, InactiveConfig, IntervalConfig, MonitorConfig, Notification, NotificationOptionControl, NotificationOptionControls, NotificationTarget, ReminderConfig, TriggerConfig } from "../../frontend/types.js";
import { durationToSeconds } from "../../frontend/editor/alert-model.js";

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
      interval: { enabled: false, value: 43200 },
    },
    inactive: { enabled: false, items: [], clear_notification: false },
  },
  notification: {
    action: "notify.mobile_app_phone",
    target: { entity_id: ["notify.phone"] },
    title: "Front door", message: "Open", options: {  },
  },
} satisfies Alert;

const canonicalConfig = {
  version: 1,
  alerts: [canonicalAlert],
} satisfies AlertsConfig;

describe("canonical frontend configuration types", () => {
  it.each([
    { duration: 300, seconds: 300 },
    { duration: "00:05:00", seconds: 300 },
    { duration: { minutes: 5 }, seconds: 300 },
  ] satisfies { duration: DurationValue; seconds: number }[])("accepts the native duration form $duration", ({ duration, seconds }) => {
    expect(durationToSeconds(duration)).toBe(seconds);
  });

  it("does not create option control groups for an untouched notification", () => {
    const notification = draftAlertFixture().notification;
    expect(notification.options).toEqual({});
    expect(notification).not.toHaveProperty("option_controls");
  });

  it("requires the Home Assistant callWS transport", () => {
    expectTypeOf<Pick<Hass, "callWS">>().toEqualTypeOf<{
      callWS<Response>(message: Record<string, unknown>): Promise<Response>;
    }>();
  });

  it("types canonical content and opaque native options", () => {
    expectTypeOf<keyof Notification>().toEqualTypeOf<"enabled" | "action" | "target" | "title" | "message" | "use_default_tag" | "options" | "option_controls">();
    expectTypeOf<Notification["title"]>().toEqualTypeOf<string>();
    expectTypeOf<Notification["message"]>().toEqualTypeOf<string>();
    expectTypeOf<Notification["options"]>().toEqualTypeOf<HaConfig>();
    const notification: Notification = {
      title: "Door", message: "Open", options: { native_extra: ["opaque"], push: { sound: "default" } },
    };
    expect(notification.options.native_extra).toEqual(["opaque"]);
  });

  it("names nested objects without changing their canonical value shapes", () => {
    expectTypeOf<MonitorConfig["triggers"]>().toEqualTypeOf<TriggerConfig>();
    expectTypeOf<MonitorConfig["conditions"]>().toEqualTypeOf<ConditionConfig>();
    expectTypeOf<keyof ConditionConfig>().toEqualTypeOf<"enabled" | "items" | "startup" | "interval">();
    expectTypeOf<ConditionConfig["interval"]>().toEqualTypeOf<IntervalConfig>();
    expectTypeOf<IntervalConfig["enabled"]>().toEqualTypeOf<boolean>();
    expectTypeOf<IntervalConfig["value"]>().toEqualTypeOf<DurationValue>();
    expectTypeOf<MonitorConfig["inactive"]>().toEqualTypeOf<InactiveConfig>();
    expectTypeOf<ConfirmationConfig["notification"]>().toEqualTypeOf<Notification>();
    expectTypeOf<Notification["enabled"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Notification["option_controls"]>().toEqualTypeOf<NotificationOptionControls | undefined>();
    expectTypeOf<ConfirmationConfig["reminders"]>().toEqualTypeOf<ReminderConfig>();
    expectTypeOf<ConfirmationConfig["buttons"]>().toEqualTypeOf<ConfirmationButton[]>();
    expectTypeOf<Alert["notification"]>().toEqualTypeOf<Notification>();
    expectTypeOf<Notification["target"]>().toEqualTypeOf<NotificationTarget | undefined>();
    expectTypeOf<NonNullable<Notification["option_controls"]>["android"]>().toEqualTypeOf<NotificationOptionControl | undefined>();
    const duration: DurationParts = { minutes: 5 };
    const button: ConfirmationButton = { id: "confirm", label: "Done" };
    const alert = draftAlertFixture();
    expect(typeof alert.confirmation.enabled).toBe("boolean");
    expect(Array.isArray(alert.confirmation.buttons)).toBe(true);
    expect(duration).toEqual({ minutes: 5 });
    expect(button).toEqual({ id: "confirm", label: "Done" });
  });

  it("includes explicit inactive configuration and monitor automation mode", () => {
    expectTypeOf<keyof MonitorConfig>().toEqualTypeOf<"automation_mode" | "triggers" | "conditions" | "inactive">();
    expectTypeOf<MonitorConfig["automation_mode"]>().toEqualTypeOf<"single" | "restart" | "queued" | "parallel">();
    const monitor: MonitorConfig = draftAlertFixture().monitor;
    expect(monitor).toMatchSnapshot();
  });

  it("snapshots the canonical versioned alert contract", () => {
    expect(canonicalConfig).toMatchSnapshot();
  });
});