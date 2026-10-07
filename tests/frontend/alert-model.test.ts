import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { editableAlert, finalizeAlert } from "../../frontend/editor/alert-model.js";
import type { Alert, MonitorConfig } from "../../frontend/types.js";
import { draftAlertFixture } from "./conftest.js";

describe("editable alert model", () => {
  it.each([null, undefined])("clones backend-owned defaults for source %s", source => {
    const defaults = draftAlertFixture({ id: "server_draft" });
    const original = structuredClone(defaults);
    const alert = editableAlert(source, defaults);
    expect(alert).toEqual(defaults);
    expect(alert.id).toBe("server_draft");
    expect(alert.confirmation.reminders.interval).toBe(1800);
    expect(alert.confirmation.reminders.timeout).toBe(900);
    alert.monitor.triggers.items.push({ trigger: "event", event_type: "changed" });
    alert.confirmation.buttons[0].label = "Changed";
    alert.notification.options.changed = true;
    expect(defaults).toEqual(original);
  });

  it("merges nested defaults without replacing false, zero, or user-owned native values", () => {
    const defaults = draftAlertFixture();
    defaults.notification.title = "Server title";
    defaults.confirmation.notification.enabled = true;
    defaults.confirmation.reminders.show_attempts = true;
    const source = {
      id: "existing", name: "Door", enabled: false,
      monitor: {
        triggers: { enabled: false, items: [{ trigger: "event", event_type: "door_opened", enabled: false }] },
        conditions: { startup: false, interval: 0 },
      },
      notification: { title: "", use_default_tag: false, target: { user_id: ["operator"] }, options: { ttl: 0, native: { enabled: false } } },
      confirmation: {
        enabled: false,
        notification: { enabled: false, message: "User message", use_default_tag: false },
        reminders: { enabled: false, interval: 0, timeout: 0, max_attempts: 0, show_attempts: false },
      },
    } as unknown as Alert;
    const originalSource = structuredClone(source);
    const originalDefaults = structuredClone(defaults);
    const draft = editableAlert(source, defaults);
    expect(draft.id).toBe("existing");
    expect(draft.enabled).toBe(false);
    expect(draft.monitor.triggers).toEqual(source.monitor.triggers);
    expect(draft.monitor.conditions).toEqual({ ...defaults.monitor.conditions, ...source.monitor.conditions });
    expect(draft.monitor.inactive).toEqual(defaults.monitor.inactive);
    expect(draft.notification).toEqual({ ...defaults.notification, ...source.notification });
    expect(draft.confirmation.notification).toEqual({ ...defaults.confirmation.notification, ...source.confirmation!.notification });
    expect(draft.confirmation.reminders).toEqual({ ...defaults.confirmation.reminders, ...source.confirmation!.reminders });
    draft.monitor.triggers.items[0].event_type = "changed";
    draft.notification.target.user_id!.push("other");
    (draft.notification.options.native as { enabled: boolean }).enabled = true;
    draft.confirmation.buttons[0].label = "Changed";
    expect(source).toEqual(originalSource);
    expect(defaults).toEqual(originalDefaults);
  });

  it.each([true, false])("preserves opaque data without using it as notification text with canonical text %s", canonical => {
    const source = draftAlertFixture({ name: "Door" });
    source.notification = {
      target: { entity_id: ["notify.phone"] },
      title: canonical ? "Door" : "",
      message: canonical ? "Door open" : "",
      options: {
        native_extra: { keep: true },
        title: "Opaque title", message: "Opaque message", custom: { keep: true },
      },
    };
    source.confirmation!.notification = {
      enabled: true,
      title: canonical ? "Confirmed" : "",
      message: canonical ? "Door closed" : "",
      options: {
        native_extra: { keep: true },
        title: "Opaque confirmation title", message: "Opaque confirmation message", custom: { keep: true },
      },
    };
    const original = structuredClone(source);
    const draft = editableAlert(source, draftAlertFixture());
    expect(draft.notification.title).toBe(canonical ? "Door" : "");
    expect(draft.notification.message).toBe(canonical ? "Door open" : "");
    expect(draft.confirmation.notification.title).toBe(canonical ? "Confirmed" : "");
    expect(draft.confirmation.notification.message).toBe(canonical ? "Door closed" : "");
    const saved = finalizeAlert(draft, false);
    expect(saved.notification).toEqual({ ...source.notification, use_default_tag: true });
    expect(saved.confirmation?.notification).toEqual({ ...source.confirmation!.notification, use_default_tag: true });
    expect(saved.notification).not.toHaveProperty("data");
    expect(saved.confirmation?.notification).not.toHaveProperty("data");
    expect(source).toEqual(original);
  });

  it.each([
    { mode: "single", expected: "single" },
    { mode: "restart", expected: "restart" },
    { mode: "queued", expected: "queued" },
    { mode: "parallel", expected: "parallel" },
    { mode: undefined, expected: "parallel" },
  ] as { mode?: MonitorConfig["automation_mode"]; expected: MonitorConfig["automation_mode"] }[])(
    "preserves canonical mode $mode with default $expected",
    ({ mode, expected }) => {
      const source = draftAlertFixture({ name: "Door", notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } } });
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
      const draft = editableAlert(input as unknown as Alert, draftAlertFixture());
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
    const source = draftAlertFixture({ name: "Door", notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } } });
    source.monitor.conditions.items = [{ condition: "state", entity_id: "binary_sensor.door", state: "on" }];
    source.monitor.inactive = {
      enabled,
      items: [{ trigger: "state", entity_id: "binary_sensor.door", to: "off", id: "closed", for: { seconds: 5 }, alias: "Door closed", enabled: false, custom: { keep: true } }],
      clear_notification: true,
    };
    const draft = editableAlert(source, draftAlertFixture());
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
    }), draftAlertFixture());

    expect(alert.monitor.triggers.items).toEqual(triggers);
    expect(alert.monitor.conditions.items).toEqual(conditions);
    expect(alert.confirmation?.reminders.interval).toBeDefined();
    expect(alert.confirmation?.actions).toEqual([]);
  });

  it("fills absent optional blocks while preserving native actions, conditions, and duration values", () => {
    const defaults = draftAlertFixture();
    const source = {
      id: "native", name: "Native alert", enabled: true,
      monitor: {
        triggers: { enabled: true, items: [{ trigger: "state", entity_id: ["binary_sensor.door"], for: { seconds: 0 }, enabled: false }] },
        conditions: { enabled: true, items: [{ condition: "template", value_template: "{{ true }}" }] },
      },
      notification: { action: "notify.custom", title: "{{ trigger.id }}", message: "Native", options: { data: { ttl: 0 } } },
      confirmation: { reminders: { interval: { minutes: 7 }, timeout: "00:02:00" } },
      post_send_actions: { enabled: false, actions: [{ action: "light.turn_on", target: { entity_id: "light.hall" }, data: { brightness: 0 } }] },
    } as unknown as Alert;
    const original = structuredClone(source);

    const draft = editableAlert(source, defaults);

    expect(draft.monitor.triggers).toEqual(source.monitor.triggers);
    expect(draft.monitor.conditions.items).toEqual(source.monitor.conditions.items);
    expect(draft.monitor.conditions.interval).toBe(defaults.monitor.conditions.interval);
    expect(draft.notification.action).toBe("notify.custom");
    expect(draft.notification.target).toEqual(defaults.notification.target);
    expect(draft.notification.options).toEqual(source.notification.options);
    expect(draft.confirmation.notification).toEqual(defaults.confirmation.notification);
    expect(draft.confirmation.reminders.interval).toEqual({ minutes: 7 });
    expect(draft.confirmation.reminders.timeout).toBe("00:02:00");
    expect(draft.post_send_actions).toEqual(source.post_send_actions);
    const saved = finalizeAlert(draft, false);
    expect(saved.confirmation!.reminders.interval).toBe(420);
    expect(saved.confirmation!.reminders.timeout).toBe(120);
    expect(saved.monitor.triggers).toEqual(source.monitor.triggers);
    expect(saved.post_send_actions).toEqual(source.post_send_actions);
    expect(source).toEqual(original);
    expect(defaults).toEqual(draftAlertFixture());
  });
});

describe("finalizeAlert", () => {
  it("validates recipients and allows incomplete YAML preview drafts", () => {
    const draft = editableAlert(draftAlertFixture({ name: "Door" }), draftAlertFixture());

    expect(() => finalizeAlert(draft, false)).toThrow(/Select at least one device/);
    expect(finalizeAlert(draft, false, false).notification.target).toEqual({});
  });

  it.each(["entity_id", "device_id", "area_id"])(
    "accepts a scalar %s target from the Home Assistant target selector",
    selector => {
      const draft = editableAlert(draftAlertFixture({ name: "Door" }), draftAlertFixture());
      draft.notification.target = { [selector]: `notify.mobile_app_phone` };

      expect(finalizeAlert(draft, false).notification.target).toEqual({
        [selector]: "notify.mobile_app_phone",
      });
    },
  );

  it("does not count empty or whitespace-only recipient values", () => {
    const draft = editableAlert(draftAlertFixture({ name: "Door" }), draftAlertFixture());
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
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
    }), draftAlertFixture());
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
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
    }), draftAlertFixture());
    const disabledResult = finalizeAlert(disabled, false);
    expect(disabledResult.confirmation?.notification.enabled).toBe(false);
    expect(disabledResult.confirmation?.notification.target).toBeUndefined();

    const enabled = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
    }), draftAlertFixture());
    enabled.confirmation!.notification.enabled = true;
    const enabledResult = finalizeAlert(enabled, false);
    expect(enabledResult.confirmation?.notification.target).toBeUndefined();
    expect(enabledResult.notification.target).toEqual({ entity_id: ["notify.phone"] });
  });

  it("includes confirmation actions only when the section is enabled", () => {
    const draft = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
    }), draftAlertFixture());
    draft.confirmation!.actions = [{ action: "light.turn_on" }];

    expect(finalizeAlert(draft, false).confirmation?.actions).toEqual([]);
    expect(finalizeAlert(draft, true).confirmation?.actions).toEqual([{ action: "light.turn_on" }]);
  });

  it("omits empty disabled post-send actions but preserves populated actions", () => {
    const draft = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
      post_send_actions: { enabled: false, actions: [] },
    }), draftAlertFixture());
    expect(finalizeAlert(draft, false)).not.toHaveProperty("post_send_actions");

    draft.post_send_actions = { enabled: false, actions: [{ action: "light.turn_on" }] };
    expect(finalizeAlert(draft, false).post_send_actions).toEqual({
      enabled: false,
      actions: [{ action: "light.turn_on" }],
    });
  });
});