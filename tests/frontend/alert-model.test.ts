import { describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { createAlertDraft, editableAlert, finalizeAlert, toCanonicalAlert } from "../../frontend/editor/alert-model.js";
import type { Alert, DurationValue, IntervalConfig, MonitorConfig } from "../../frontend/types.js";
import alertDefaults from "../contracts/alert_defaults.json";
import optionControls from "../contracts/option_controls.json";
import { draftAlertFixture } from "./conftest.js";

describe("editable alert model", () => {
  it("roundtrips disabled values and controls from the shared backend contract", () => {
    const draft = editableAlert(draftAlertFixture({ name: "Saved settings", notification: optionControls.notification }));
    const saved = finalizeAlert(draft);
    expect(saved.notification).toEqual(optionControls.notification);
    expect(toCanonicalAlert(saved).notification).toEqual(optionControls.notification);
    expect(parse(stringify(saved)).notification).toEqual(optionControls.notification);
  });

  it("serializes frontend draft defaults with the canonical schema-parity fixture", () => {
    const draft = createAlertDraft();
    expect(JSON.parse(JSON.stringify({ ...draft, id: alertDefaults.id }))).toEqual(alertDefaults);
  });

  it("generates fresh UUID ids and independent nested defaults", () => {
    const first = createAlertDraft();
    const second = createAlertDraft();
    const originalSecond = structuredClone(second);
    expect(first.id).toMatch(/^alert_[0-9a-f]{32}$/);
    expect(second.id).toMatch(/^alert_[0-9a-f]{32}$/);
    expect(first.id).not.toBe(second.id);
    first.monitor.triggers.items.push({ trigger: "event", event_type: "changed" });
    first.monitor.conditions.items.push({ condition: "template", value_template: "{{ true }}" });
    first.monitor.conditions.interval.enabled = true;
    first.monitor.conditions.interval.value = 0;
    first.monitor.inactive.items.push({ trigger: "event", event_type: "closed" });
    first.notification.target.entity_id = ["notify.phone"];
    first.notification.options.changed = true;
    first.confirmation.buttons[0].label = "Changed";
    first.confirmation.notification.options.changed = true;
    first.confirmation.reminders.interval = 0;
    first.confirmation.actions.items.push({ action: "light.turn_on" });
    expect(second).toEqual(originalSecond);
  });

  it("creates and edits alerts when randomUUID is unavailable on an HTTP origin", () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    try {
      const first = createAlertDraft();
      const second = editableAlert(null);
      expect(first.id).toMatch(/^alert_[0-9a-f]{32}$/);
      expect(second.id).toMatch(/^alert_[0-9a-f]{32}$/);
      expect(first.id).not.toBe(second.id);
      const source = draftAlertFixture({ id: "existing", name: "Existing alert" });
      const edited = editableAlert(source);
      expect(edited).toEqual(source);
      expect(edited).not.toBe(source);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([null, undefined])("creates local defaults without injection for source %s", source => {
    const first = editableAlert(source);
    const second = editableAlert(source);
    expect(first.id).toMatch(/^alert_[0-9a-f]{32}$/);
    expect(first.id).not.toBe(second.id);
    expect({ ...first, id: "alert_draft" }).toEqual(draftAlertFixture());
    first.confirmation.buttons[0].label = "Changed";
    expect(second.confirmation.buttons[0].label).toBe("Done");
  });

  it.each([null, undefined])("clones test-injected defaults for source %s", source => {
    const defaults = draftAlertFixture({ id: "test_draft" });
    const original = structuredClone(defaults);
    const alert = editableAlert(source, defaults);
    expect(alert).toEqual(defaults);
    expect(alert.id).toBe("test_draft");
    expect(alert.confirmation.reminders.interval).toBe(1800);
    expect(alert.confirmation.reminders.forget_after).toEqual({ enabled: false, value: 900 });
    alert.monitor.triggers.items.push({ trigger: "event", event_type: "changed" });
    alert.confirmation.buttons[0].label = "Changed";
    alert.notification.options.changed = true;
    expect(defaults).toEqual(original);
  });

  it("merges nested defaults without replacing false, zero, or user-owned native values", () => {
    const defaults = draftAlertFixture();
    defaults.notification.title = "Injected title";
    defaults.confirmation.notification.enabled = true;
    defaults.confirmation.reminders.show_attempts = true;
    const source = {
      id: "existing", name: "Door", enabled: false,
      monitor: {
        triggers: { enabled: false, items: [{ trigger: "event", event_type: "door_opened", enabled: false }] },
        conditions: { startup: false, interval: { enabled: false, value: 0 } },
      },
      notification: { title: "", use_default_tag: false, target: { user_id: ["operator"] }, options: { ttl: 0, native: { enabled: false } } },
      confirmation: {
        enabled: false,
        notification: { enabled: false, message: "User message", use_default_tag: false },
        reminders: { enabled: false, interval: 0, forget_after: { enabled: false, value: 0 }, max_attempts: 0, show_attempts: false },
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

  it.each([
    {},
    { enabled: true },
    { enabled: false },
    { value: 0 },
    { value: { hours: 2 } },
    { enabled: false, value: "01:00:00" },
  ] satisfies Partial<IntervalConfig>[])("merges partial interval defaults without replacing supplied fields %j", interval => {
    const defaults = draftAlertFixture();
    defaults.monitor.conditions.interval = { enabled: true, value: 7200 };
    const source = {
      ...defaults,
      monitor: {
        ...defaults.monitor,
        conditions: { ...defaults.monitor.conditions, enabled: false, interval },
      },
    } as unknown as Alert;
    const originalSource = structuredClone(source);
    const originalDefaults = structuredClone(defaults);
    const draft = editableAlert(source, defaults);
    expect(draft.monitor.conditions.enabled).toBe(false);
    expect(draft.monitor.conditions.interval).toEqual({ ...defaults.monitor.conditions.interval, ...interval });
    expect(draft.monitor.conditions).not.toHaveProperty("periodic");
    expect(draft.monitor).not.toHaveProperty("periodic");
    draft.monitor.conditions.interval.enabled = false;
    draft.monitor.conditions.interval.value = 1;
    expect(source).toEqual(originalSource);
    expect(defaults).toEqual(originalDefaults);
  });

  it.each([0, 480, "00:08:00", { minutes: 8 }] satisfies DurationValue[])(
    "saves and reopens a disabled interval without normalizing its native value %j",
    value => {
      const source = draftAlertFixture({ name: "Door" });
      source.notification.action = "notify.custom";
      source.monitor.conditions.interval = { enabled: true, value };
      const original = structuredClone(source);
      const draft = editableAlert(source);
      draft.monitor.conditions.interval.enabled = false;
      const saved = finalizeAlert(draft);
      const canonical = toCanonicalAlert(saved);
      const yamlAlert = parse(stringify(canonical)) as Alert;
      const reopened = editableAlert(yamlAlert);
      for (const alert of [saved, canonical, yamlAlert, reopened]) {
        expect(alert.monitor.conditions.interval).toEqual({ enabled: false, value });
        expect(alert.monitor.conditions).not.toHaveProperty("periodic");
        expect(alert.monitor).not.toHaveProperty("periodic");
      }
      reopened.monitor.conditions.interval.enabled = true;
      expect(finalizeAlert(reopened).monitor.conditions.interval).toEqual({ enabled: true, value });
      expect(source).toEqual(original);
    },
  );

  it.each([true, false])("retains child interval enablement %s when the parent conditions are disabled", enabled => {
    const draft = draftAlertFixture({ name: "Door" });
    draft.notification.action = "notify.custom";
    draft.monitor.conditions.interval = { enabled, value: { hours: 2 } };
    draft.monitor.conditions.enabled = false;
    const saved = finalizeAlert(draft);
    const reopened = editableAlert(saved);
    expect(reopened.monitor.conditions.enabled).toBe(false);
    expect(reopened.monitor.conditions.interval).toEqual({ enabled, value: { hours: 2 } });
    reopened.monitor.conditions.enabled = true;
    expect(finalizeAlert(reopened).monitor.conditions.interval).toEqual({ enabled, value: { hours: 2 } });
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
    const saved = finalizeAlert(draft);
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
        const saved = finalizeAlert(draft, validate);
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
      const saved = finalizeAlert(draft, validate);
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
          interval: { enabled: false, value: 12 * 60 * 60 },
        },
      },
    }), draftAlertFixture());

    expect(alert.monitor.triggers.items).toEqual(triggers);
    expect(alert.monitor.conditions.items).toEqual(conditions);
    expect(alert.confirmation?.reminders.interval).toBeDefined();
    expect(alert.confirmation?.actions).toEqual({ enabled: false, items: [] });
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
      confirmation: { reminders: { interval: { minutes: 7 }, forget_after: { value: "00:02:00" } } },
      post_send_actions: { enabled: false, items: [{ action: "light.turn_on", target: { entity_id: "light.hall" }, data: { brightness: 0 } }] },
    } as unknown as Alert;
    const original = structuredClone(source);

    const draft = editableAlert(source, defaults);

    expect(draft.monitor.triggers).toEqual(source.monitor.triggers);
    expect(draft.monitor.conditions.items).toEqual(source.monitor.conditions.items);
    expect(draft.monitor.conditions.interval).toEqual(defaults.monitor.conditions.interval);
    expect(draft.notification.action).toBe("notify.custom");
    expect(draft.notification.target).toEqual(defaults.notification.target);
    expect(draft.notification.options).toEqual(source.notification.options);
    expect(draft.confirmation.notification).toEqual(defaults.confirmation.notification);
    expect(draft.confirmation.reminders.interval).toEqual({ minutes: 7 });
    expect(draft.confirmation.reminders.forget_after).toEqual({ enabled: false, value: "00:02:00" });
    expect(draft.post_send_actions).toEqual(source.post_send_actions);
    const saved = finalizeAlert(draft);
    expect(saved.confirmation!.reminders.interval).toBe(420);
    expect(saved.confirmation!.reminders.forget_after.value).toBe(120);
    expect(saved.monitor.triggers).toEqual(source.monitor.triggers);
    expect(saved.post_send_actions).toEqual(source.post_send_actions);
    expect(source).toEqual(original);
    expect(defaults).toEqual(draftAlertFixture());
  });
});

describe("finalizeAlert", () => {
  it.each(["", "notify", "notify.", "notify.phone.extra", "  notify.phone"])("rejects an invalid notification action %s", action => {
    const draft = draftAlertFixture({ name: "Door" });
    draft.notification.action = action;
    expect(() => finalizeAlert(draft)).toThrow(/domain.service/);
    delete draft.notification.action;
    draft.notification.target = { entity_id: ["notify.phone"] };
    draft.confirmation.notification.action = action;
    expect(() => finalizeAlert(draft)).toThrow(/domain.service/);
  });

  it("reports a missing notification target rather than relying on a wrapper type", () => {
    const draft = draftAlertFixture({ name: "Door" });
    delete draft.notification.target;
    expect(() => finalizeAlert(draft)).toThrow(/Select at least one device/);
    draft.notification.action = "notify.mobile_app_phone";
    expect(finalizeAlert(draft).notification.action).toBe("notify.mobile_app_phone");
    expect(finalizeAlert(draft).notification).not.toHaveProperty("target");
  });

  it("clones once while normalizing durations and isolating the successful payload", () => {
    const draft = draftAlertFixture({ name: "  Door  " });
    draft.notification.target = { entity_id: ["notify.phone"] };
    draft.monitor.triggers.items = [{ trigger: "state", entity_id: "binary_sensor.door", for: { seconds: 0 }, native: { enabled: false } }];
    draft.notification.options = {
      ttl: 0, native: { enabled: false }, sticky: false, timeout: 0,
      push: { badge: 0, sound: { name: "default", critical: 1, volume: 0.8 }, custom: false },
    };
    draft.notification.option_controls = {
      android: { enabled: false, fields: { sticky: false, timeout: false } },
      ios: { enabled: true, fields: { "push.badge": false, "push.sound": false } },
    };
    draft.confirmation.reminders.interval = { minutes: 7 };
    draft.confirmation.reminders.forget_after.value = "00:02:00";
    draft.confirmation.actions.items = [{ action: "light.turn_on" }];
    draft.runtime = { active: true };
    const original = structuredClone(draft);
    const clone = vi.spyOn(globalThis, "structuredClone");
    try {
      const saved = finalizeAlert(draft);
      expect(clone).toHaveBeenCalledExactlyOnceWith(draft);
      expect(draft).toEqual(original);
      expect(saved).not.toBe(draft);
      expect(saved.name).toBe("Door");
      expect(saved).not.toHaveProperty("runtime");
      expect(saved.confirmation!.actions).toEqual(original.confirmation.actions);
      expect(saved.confirmation!.reminders.interval).toBe(420);
      expect(saved.confirmation!.reminders.forget_after.value).toBe(120);
      expect(JSON.parse(JSON.stringify(saved.monitor))).toEqual(original.monitor);
      expect(saved.notification.options).toEqual(original.notification.options);
      expect(saved.notification.option_controls).toEqual(original.notification.option_controls);
      saved.monitor.triggers.items[0].event_type = "changed";
      saved.notification.target.entity_id!.push("notify.other");
      (saved.notification.options.native as { enabled: boolean }).enabled = true;
      saved.notification.option_controls!.android!.enabled = true;
      saved.notification.option_controls!.ios!.fields["push.badge"] = true;
      saved.confirmation!.buttons[0].label = "Changed";
      expect(draft).toEqual(original);
    } finally {
      clone.mockRestore();
    }
  });

  it.each(["recipients", "duration"])("clones once and leaves the draft unchanged on %s failure", failure => {
    const draft = draftAlertFixture({ name: "  Door  " });
    draft.confirmation.reminders.interval = { minutes: 7 };
    draft.confirmation.actions.items = [{ action: "light.turn_on" }];
    draft.runtime = { active: true };
    let message = /Select at least one device/;
    if (failure === "duration") {
      draft.notification.target = { entity_id: ["notify.phone"] };
      draft.confirmation.reminders.forget_after.value = "invalid";
      message = /Confirmation timeout must be a valid duration/;
    }
    const original = structuredClone(draft);
    const clone = vi.spyOn(globalThis, "structuredClone");
    try {
      expect(() => finalizeAlert(draft)).toThrow(message);
      expect(clone).toHaveBeenCalledExactlyOnceWith(draft);
      expect(draft).toEqual(original);
    } finally {
      clone.mockRestore();
    }
  });

  it("validates recipients and allows incomplete YAML preview drafts", () => {
    const draft = editableAlert(draftAlertFixture({ name: "Door" }), draftAlertFixture());

    expect(() => finalizeAlert(draft)).toThrow(/Select at least one device/);
    expect(finalizeAlert(draft, false).notification.target).toEqual({});
  });

  it.each(["entity_id", "device_id", "area_id"])(
    "accepts a scalar %s target from the Home Assistant target selector",
    selector => {
      const draft = editableAlert(draftAlertFixture({ name: "Door" }), draftAlertFixture());
      draft.notification.target = { [selector]: `notify.mobile_app_phone` };

      expect(finalizeAlert(draft).notification.target).toEqual({
        [selector]: "notify.mobile_app_phone",
      });
    },
  );

  it("does not count empty or whitespace-only recipient values", () => {
    const draft = editableAlert(draftAlertFixture({ name: "Door" }), draftAlertFixture());
    draft.notification.target = { entity_id: ["", "  "] };

    expect(() => finalizeAlert(draft)).toThrow(/Select at least one device/);
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
          interval: { enabled: false, value: 12 * 60 * 60 },
        },
      },
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
    }), draftAlertFixture());
    draft.runtime = { active: true };

    const result = finalizeAlert(draft);

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
    const disabledResult = finalizeAlert(disabled);
    expect(disabledResult.confirmation?.notification.enabled).toBe(false);
    expect(disabledResult.confirmation?.notification.target).toBeUndefined();

    const enabled = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
    }), draftAlertFixture());
    enabled.confirmation!.notification.enabled = true;
    const enabledResult = finalizeAlert(enabled);
    expect(enabledResult.confirmation?.notification.target).toBeUndefined();
    expect(enabledResult.notification.target).toEqual({ entity_id: ["notify.phone"] });
  });

  it.each([true, false])("preserves confirmation actions with section enabled=%s", enabled => {
    const draft = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
    }), draftAlertFixture());
    draft.confirmation.actions = { enabled, items: [{ action: "light.turn_on" }] };

    const original = structuredClone(draft);
    const saved = finalizeAlert(draft);
    expect(saved.confirmation?.actions).toEqual({ enabled, items: [{ action: "light.turn_on" }] });
    const reopened = editableAlert(saved);
    expect(reopened.confirmation.actions).toEqual(draft.confirmation.actions);
    expect(finalizeAlert(reopened)).toEqual(saved);
    expect(draft).toEqual(original);
  });

  it("keeps untouched confirmation actions disabled and empty", () => {
    const draft = editableAlert(draftAlertFixture({ name: "Door" }));
    draft.notification.target = { entity_id: ["notify.phone"] };
    expect(finalizeAlert(draft)).toEqual(draft);
    expect(finalizeAlert(draft).confirmation!.actions).toEqual({ enabled: false, items: [] });
  });

  it("omits empty disabled post-send actions but preserves populated actions", () => {
    const draft = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
      post_send_actions: { enabled: false, items: [] },
    }), draftAlertFixture());
    expect(finalizeAlert(draft)).not.toHaveProperty("post_send_actions");

    draft.post_send_actions = { enabled: false, items: [{ action: "light.turn_on" }] };
    expect(finalizeAlert(draft).post_send_actions).toEqual({
      enabled: false,
      items: [{ action: "light.turn_on" }],
    });
  });
});

describe("toCanonicalAlert", () => {
  it("returns an independent clone without mutating duration or native JSON values", () => {
    const alert = draftAlertFixture();
    alert.confirmation.reminders.interval = { minutes: 7 };
    alert.confirmation.reminders.forget_after.value = "00:02:00";
    alert.monitor.triggers.items = [{ trigger: "state", for: { seconds: 0 }, enabled: false }];
    alert.notification.options = { native: { enabled: false }, ttl: 0 };
    alert.runtime = { current: 2 };
    const original = structuredClone(alert);

    const serialized = toCanonicalAlert(alert);

    expect(serialized).not.toBe(alert);
    expect(serialized).not.toHaveProperty("runtime");
    expect(serialized.confirmation!.reminders.interval).toBe(420);
    expect(serialized.confirmation!.reminders.forget_after.value).toBe(120);
    expect(JSON.parse(JSON.stringify(serialized.monitor))).toEqual(original.monitor);
    expect(serialized.notification.options).toEqual(original.notification.options);
    expect(alert).toEqual(original);
    serialized.monitor.triggers.items[0].enabled = true;
    (serialized.notification.options.native as { enabled: boolean }).enabled = true;
    serialized.confirmation!.buttons[0].label = "Changed";
    expect(alert).toEqual(original);
  });

  it("leaves the input unchanged when normalization fails after a valid interval", () => {
    const alert = draftAlertFixture();
    alert.confirmation.reminders.interval = { minutes: 7 };
    alert.confirmation.reminders.forget_after.value = "invalid";
    const original = structuredClone(alert);

    expect(() => toCanonicalAlert(alert)).toThrow(/Confirmation timeout must be a valid duration/);
    expect(alert).toEqual(original);
  });
});