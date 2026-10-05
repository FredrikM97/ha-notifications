import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { confirmationNotificationEnabled, editableAlert, finalizeAlert } from "../../frontend/editor/alert-model.js";
import type { Alert, MonitorConfig } from "../../frontend/types.js";
import { draftAlertFixture } from "./conftest.js";

describe("editable alert model", () => {
  it.each([
    { mode: "single", expected: "single" },
    { mode: "restart", expected: "restart" },
    { mode: "queued", expected: "queued" },
    { mode: "parallel", expected: "parallel" },
    { mode: undefined, expected: "parallel" },
  ] as { mode?: MonitorConfig["automation_mode"]; expected: MonitorConfig["automation_mode"] }[])(
    "preserves canonical mode $mode with default $expected",
    ({ mode, expected }) => {
      const source = draftAlertFixture({ name: "Door", notification: { target: { entity_id: ["notify.phone"] }, data: {} } });
      const triggers = [{ trigger: "event", event_type: "door_opened", event_data: { source: "sensor" }, id: "opened", enabled: false }];
      const input = {
        ...source,
        monitor: {
          triggers: { enabled: true, items: triggers },
          conditions: source.monitor.conditions,
          ...(mode ? { automation_mode: mode } : {}),
        },
      };
      const original = structuredClone(input);
      const draft = editableAlert(input as unknown as Alert);
      expect(draft.monitor.automation_mode).toBe(expected);
      expect(draft.monitor.inactive).toEqual({ enabled: false, items: [], clear_notification: false });
      expect(input).toEqual(original);
      for (const validate of [true, false]) {
        const saved = finalizeAlert(draft, false, validate);
        const yamlMonitor = parse(stringify(saved)).monitor;
        expect(yamlMonitor).toEqual(saved.monitor);
        expect(yamlMonitor.automation_mode).toBe(expected);
        expect(yamlMonitor.triggers).toEqual({ enabled: true, items: triggers });
      }
    },
  );

  it.each([true, false])("preserves explicit inactive triggers when enabled is %s without inferring triggers", enabled => {
    const source = draftAlertFixture({ name: "Door", notification: { target: { entity_id: ["notify.phone"] }, data: {} } });
    source.monitor.conditions.items = [{ condition: "state", entity_id: "binary_sensor.door", state: "on" }];
    source.monitor.inactive = {
      enabled,
      items: [{ trigger: "state", entity_id: "binary_sensor.door", to: "off", id: "closed", for: { seconds: 5 }, alias: "Door closed", enabled: false, custom: { keep: true } }],
      clear_notification: true,
    };
    const draft = editableAlert(source);
    expect(draft.monitor.inactive).toEqual(source.monitor.inactive);
    expect(draft.monitor.triggers.items).toEqual([]);
    expect(draft.monitor.inactive).not.toBe(source.monitor.inactive);
    for (const validate of [true, false]) {
      const saved = finalizeAlert(draft, false, validate);
      expect(parse(stringify(saved)).monitor).toEqual(saved.monitor);
      expect(saved.monitor.inactive).toEqual(source.monitor.inactive);
      expect(saved.monitor.triggers.items).toEqual([]);
    }
  });

  it("infers confirmation follow-up state from populated data unless explicitly disabled", () => {
    expect(confirmationNotificationEnabled({ data: {} })).toBe(true);
    expect(confirmationNotificationEnabled({ data: { message: "Done" } })).toBe(true);
    expect(confirmationNotificationEnabled({ enabled: false, data: {} })).toBe(false);
  });

  it("fills optional editor blocks without changing native automation data", () => {
    const triggers = [{ trigger: "event", event_type: "door_opened" }];
    const conditions = [{ condition: "template", value_template: "{{ true }}" }];
    const alert = editableAlert(draftAlertFixture({
      monitor: {
        ...draftAlertFixture().monitor,
        triggers: { enabled: true, items: triggers },
        conditions: {
          enabled: true,
          items: conditions,
          startup: false,
          periodic: false,
          interval: 12 * 60 * 60,
        },
      },
    }));

    expect(alert.monitor.triggers.items).toEqual(triggers);
    expect(alert.monitor.conditions.items).toEqual(conditions);
    expect(alert.confirmation?.reminders.interval).toBeDefined();
    expect(alert.confirmation?.actions).toEqual([]);
  });
});

describe("finalizeAlert", () => {
  it("validates recipients and allows incomplete YAML preview drafts", () => {
    const draft = editableAlert(draftAlertFixture({ name: "Door" }));

    expect(() => finalizeAlert(draft, false)).toThrow(/Select at least one device/);
    expect(finalizeAlert(draft, false, false).notification.target).toEqual({});
  });

  it.each(["entity_id", "device_id", "area_id"])(
    "accepts a scalar %s target from the Home Assistant target selector",
    selector => {
      const draft = editableAlert(draftAlertFixture({ name: "Door" }));
      draft.notification.target = { [selector]: `notify.mobile_app_phone` };

      expect(finalizeAlert(draft, false).notification.target).toEqual({
        [selector]: "notify.mobile_app_phone",
      });
    },
  );

  it("does not count empty or whitespace-only recipient values", () => {
    const draft = editableAlert(draftAlertFixture({ name: "Door" }));
    draft.notification.target = { entity_id: ["", "  "] };

    expect(() => finalizeAlert(draft, false)).toThrow(/Select at least one device/);
  });

  it("preserves canonical automation data and strips runtime state", () => {
    const triggers = [{ trigger: "event", event_type: "door_opened" }];
    const conditions = [{ condition: "state", entity_id: "binary_sensor.door", state: "on" }];
    const draft = editableAlert(draftAlertFixture({
      name: "  Door open  ",
      monitor: {
        ...draftAlertFixture().monitor,
        triggers: { enabled: true, items: triggers },
        conditions: {
          enabled: true,
          items: conditions,
          startup: false,
          periodic: false,
          interval: 12 * 60 * 60,
        },
      },
      notification: { target: { entity_id: ["notify.phone"] }, data: {} },
    }));
    draft.runtime = { active: true };

    const result = finalizeAlert(draft, false);

    expect(result.name).toBe("Door open");
    expect(result.monitor.triggers.items).toEqual(triggers);
    expect(result.monitor.conditions.items).toEqual(conditions);
    expect(result).not.toHaveProperty("runtime");
  });

  it("keeps confirmation delivery disabled by default and inherits recipients when enabled", () => {
    const disabled = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, data: {} },
    }));
    const disabledResult = finalizeAlert(disabled, false);
    expect(disabledResult.confirmation?.notification.enabled).toBe(false);
    expect(disabledResult.confirmation?.notification.target).toBeUndefined();

    const enabled = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, data: {} },
    }));
    enabled.confirmation!.notification.enabled = true;
    const enabledResult = finalizeAlert(enabled, false);
    expect(enabledResult.confirmation?.notification.target).toEqual({ entity_id: ["notify.phone"] });
  });

  it("includes confirmation actions only when the section is enabled", () => {
    const draft = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, data: {} },
    }));
    draft.confirmation!.actions = [{ action: "light.turn_on" }];

    expect(finalizeAlert(draft, false).confirmation?.actions).toEqual([]);
    expect(finalizeAlert(draft, true).confirmation?.actions).toEqual([{ action: "light.turn_on" }]);
  });

  it("omits empty disabled post-send actions but preserves populated actions", () => {
    const draft = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, data: {} },
      post_send_actions: { enabled: false, actions: [] },
    }));
    expect(finalizeAlert(draft, false)).not.toHaveProperty("post_send_actions");

    draft.post_send_actions = { enabled: false, actions: [{ action: "light.turn_on" }] };
    expect(finalizeAlert(draft, false).post_send_actions).toEqual({
      enabled: false,
      actions: [{ action: "light.turn_on" }],
    });
  });
});