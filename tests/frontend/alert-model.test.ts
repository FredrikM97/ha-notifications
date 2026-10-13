import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { finalizeAlert, toCanonicalAlert } from "../../frontend/editor/alert-model.js";
import type { Alert, DurationValue } from "../../frontend/types.js";
import alertDefaults from "../contracts/alert_defaults.json";
import optionControls from "../contracts/option_controls.json";
import { draftAlertFixture } from "./conftest.js";

describe("alert draft model", () => {
  it("roundtrips disabled values and controls from the shared backend contract", () => {
    const draft = draftAlertFixture({ name: "Saved settings", notification: optionControls.notification });
    const saved = finalizeAlert(draft);
    expect(saved.notification).toEqual(optionControls.notification);
    expect(toCanonicalAlert(saved).notification).toEqual(optionControls.notification);
    expect(parse(stringify(saved)).notification).toEqual(optionControls.notification);
  });

  it("uses the backend-owned defaults in the shared schema-parity fixture", () => {
    const draft = draftAlertFixture();
    expect(JSON.parse(JSON.stringify({ ...draft, id: alertDefaults.id }))).toEqual(alertDefaults);
  });

  it("keeps finalized metadata within the canonical backend defaults", () => {
    const draft = draftAlertFixture({ name: "Door", icon: "" });
    draft.notification.target = { entity_id: ["notify.phone"] };

    const saved = finalizeAlert(draft);

    expect(saved.description).toBe("");
    expect(saved.icon).toBe("mdi:bell-outline");
    expect(saved.notification.use_default_tag).toBe(true);
  });

  it("keeps fixture drafts independent", () => {
    const first = draftAlertFixture();
    const second = draftAlertFixture();
    first.monitor.triggers.items.push({ trigger: "event", event_type: "changed" });
    first.confirmation.buttons[0].label = "Changed";
    expect(second.monitor.triggers.items).toEqual([]);
    expect(second.confirmation.buttons[0].label).toBe("Done");
  });

  it.each([0, 480, "00:08:00", { minutes: 8 }] satisfies DurationValue[])(
    "saves and reopens a disabled interval without normalizing its native value %j",
    value => {
      const source = draftAlertFixture({ name: "Door" });
      source.notification.action = "notify.custom";
      source.monitor.conditions.interval = { enabled: true, value };
      const original = structuredClone(source);
      const draft = source;
      draft.monitor.conditions.interval.enabled = false;
      const saved = finalizeAlert(draft);
      const canonical = toCanonicalAlert(saved);
      const yamlAlert = parse(stringify(canonical)) as Alert;
      const reopened = yamlAlert;
      for (const alert of [saved, canonical, yamlAlert, reopened]) {
        expect(alert.monitor.conditions.interval).toEqual({ enabled: false, value });
        expect(alert.monitor.conditions).not.toHaveProperty("periodic");
        expect(alert.monitor).not.toHaveProperty("periodic");
      }
      reopened.monitor.conditions.interval.enabled = true;
      expect(finalizeAlert(reopened).monitor.conditions.interval).toEqual({ enabled: true, value });
      expect(source.monitor.conditions.interval).toEqual({ enabled: false, value });
    },
  );

  it.each([true, false])("retains child interval enablement %s when the parent conditions are disabled", enabled => {
    const draft = draftAlertFixture({ name: "Door" });
    draft.notification.action = "notify.custom";
    draft.monitor.conditions.interval = { enabled, value: { hours: 2 } };
    draft.monitor.conditions.enabled = false;
    const saved = finalizeAlert(draft);
    const reopened = saved;
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
      use_default_tag: true,
      options: {
        native_extra: { keep: true },
        title: "Opaque title", message: "Opaque message", custom: { keep: true },
      },
    };
    source.confirmation!.notification = {
      enabled: true,
      title: canonical ? "Confirmed" : "",
      message: canonical ? "Door closed" : "",
      use_default_tag: true,
      options: {
        native_extra: { keep: true },
        title: "Opaque confirmation title", message: "Opaque confirmation message", custom: { keep: true },
      },
    };
    const draft = source;
    expect(draft.notification.title).toBe(canonical ? "Door" : "");
    expect(draft.notification.message).toBe(canonical ? "Door open" : "");
    expect(draft.confirmation.notification.title).toBe(canonical ? "Confirmed" : "");
    expect(draft.confirmation.notification.message).toBe(canonical ? "Door closed" : "");
    const saved = finalizeAlert(draft);
    expect(saved.notification).toEqual({ ...source.notification, use_default_tag: true });
    expect(saved.confirmation?.notification).toEqual({ ...source.confirmation!.notification, use_default_tag: true });
    expect(saved.notification).not.toHaveProperty("data");
    expect(saved.confirmation?.notification).not.toHaveProperty("data");
    expect(source.notification.options).toEqual({
      native_extra: { keep: true },
      title: "Opaque title", message: "Opaque message", custom: { keep: true },
    });
  });

  it.each([true, false])("preserves explicit inactive triggers when enabled is %s without inferring triggers", enabled => {
    const source = draftAlertFixture({ name: "Door", notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } } });
    source.monitor.conditions.items = [{ condition: "state", entity_id: "binary_sensor.door", state: "on" }];
    source.monitor.inactive = {
      enabled,
      items: [{ trigger: "state", entity_id: "binary_sensor.door", to: "off", id: "closed", for: { seconds: 5 }, alias: "Door closed", enabled: false, custom: { keep: true } }],
      clear_notification: true,
    };
    const draft = source;
    expect(draft.monitor.inactive).toEqual(source.monitor.inactive);
    expect(draft.monitor.triggers.items).toEqual([]);
    expect(draft.monitor.inactive).toBe(source.monitor.inactive);
    for (const validate of [true, false]) {
      const saved = finalizeAlert(draft, validate);
      expect(parse(stringify(saved)).monitor).toEqual(saved.monitor);
      expect(saved.monitor.inactive).toEqual(source.monitor.inactive);
      expect(saved.monitor.triggers.items).toEqual([]);
    }
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

  it("preserves native duration forms on the working draft", () => {
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
    const saved = finalizeAlert(draft);
    expect(saved).toBe(draft);
    expect(saved.name).toBe("Door");
    expect(saved).not.toHaveProperty("runtime");
    expect(saved.confirmation!.reminders.interval).toEqual({ minutes: 7 });
    expect(saved.confirmation!.reminders.forget_after.value).toBe("00:02:00");
  });

  it.each(["recipients", "duration"])("leaves the draft unchanged on %s failure", failure => {
    const draft = draftAlertFixture({ name: "  Door  " });
    draft.confirmation.reminders.interval = { minutes: 7 };
    draft.confirmation.actions.items = [{ action: "light.turn_on" }];
    draft.runtime = { active: true };
    let message = /Select at least one device/;
    if (failure === "duration") {
      draft.notification.target = { entity_id: ["notify.phone"] };
      draft.confirmation.reminders.forget_after.enabled = true;
      draft.confirmation.reminders.forget_after.value = "invalid";
      message = /Forget-after duration must be greater than zero/;
    }
    const original = structuredClone(draft);
    expect(() => finalizeAlert(draft)).toThrow(message);
    expect(draft).toEqual(original);
  });

  it("validates recipients and allows incomplete YAML preview drafts", () => {
    const draft = draftAlertFixture({ name: "Door" });

    expect(() => finalizeAlert(draft)).toThrow(/Select at least one device/);
    expect(finalizeAlert(draft, false).notification.target).toEqual({});
  });

  it.each(["entity_id", "device_id", "area_id"])(
    "accepts a scalar %s target from the Home Assistant target selector",
    selector => {
      const draft = draftAlertFixture({ name: "Door" });
      draft.notification.target = { [selector]: `notify.mobile_app_phone` };

      expect(finalizeAlert(draft).notification.target).toEqual({
        [selector]: "notify.mobile_app_phone",
      });
    },
  );

  it("does not count empty or whitespace-only recipient values", () => {
    const draft = draftAlertFixture({ name: "Door" });
    draft.notification.target = { entity_id: ["", "  "] };

    expect(() => finalizeAlert(draft)).toThrow(/Select at least one device/);
  });

  it("preserves canonical automation data and strips runtime state", () => {
    const triggers = [{ trigger: "event", event_type: "door_opened" }];
    const conditions = [{ condition: "state", entity_id: "binary_sensor.door", state: "on" }];
    const draft = draftAlertFixture({
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
    });
    draft.runtime = { active: true };

    const result = finalizeAlert(draft);

    expect(result.name).toBe("Door open");
    expect(result.monitor.triggers.items).toEqual(triggers);
    expect(result.monitor.conditions.items).toEqual(conditions);
    expect(result).not.toHaveProperty("runtime");
  });

  it("keeps confirmation delivery disabled by default and inherits recipients when enabled", () => {
    const disabled = draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
    });
    const disabledResult = finalizeAlert(disabled);
    expect(disabledResult.confirmation?.notification.enabled).toBe(false);
    expect(disabledResult.confirmation?.notification.target).toBeUndefined();

    const enabled = draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
    });
    enabled.confirmation!.notification.enabled = true;
    const enabledResult = finalizeAlert(enabled);
    expect(enabledResult.confirmation?.notification.target).toBeUndefined();
    expect(enabledResult.notification.target).toEqual({ entity_id: ["notify.phone"] });
  });

  it.each([true, false])("preserves confirmation actions with section enabled=%s", enabled => {
    const draft = draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
    });
    draft.confirmation.actions = { enabled, items: [{ action: "light.turn_on" }] };

    const original = structuredClone(draft);
    const saved = finalizeAlert(draft);
    expect(saved.confirmation?.actions).toEqual({ enabled, items: [{ action: "light.turn_on" }] });
    const reopened = saved;
    expect(reopened.confirmation.actions).toEqual(draft.confirmation.actions);
    expect(finalizeAlert(reopened)).toEqual(saved);
    expect(draft).toEqual(original);
  });

  it("keeps untouched confirmation actions disabled and empty", () => {
    const draft = draftAlertFixture({ name: "Door" });
    draft.notification.target = { entity_id: ["notify.phone"] };
    expect(finalizeAlert(draft)).toEqual(draft);
    expect(finalizeAlert(draft).confirmation!.actions).toEqual({ enabled: false, items: [] });
  });

  it("omits empty disabled post-send actions but preserves populated actions", () => {
    const draft = draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] }, title: "", message: "", options: {  } },
      post_send_actions: { enabled: false, items: [] },
    });
    expect(finalizeAlert(draft)).not.toHaveProperty("post_send_actions");

    draft.post_send_actions = { enabled: false, items: [{ action: "light.turn_on" }] };
    expect(finalizeAlert(draft).post_send_actions).toEqual({
      enabled: false,
      items: [{ action: "light.turn_on" }],
    });
  });
});

describe("toCanonicalAlert", () => {
  it("preserves reminder values and omits runtime from the canonical result", () => {
    const alert = draftAlertFixture();
    alert.confirmation.reminders.interval = { minutes: 7 };
    alert.confirmation.reminders.forget_after.value = "00:02:00";
    alert.monitor.triggers.items = [{ trigger: "state", for: { seconds: 0 }, enabled: false }];
    alert.notification.options = { native: { enabled: false }, ttl: 0 };
    alert.runtime = { current: 2 };
    const serialized = toCanonicalAlert(alert);

    expect(serialized).not.toBe(alert);
    expect(serialized).not.toHaveProperty("runtime");
    expect(serialized.confirmation!.reminders.interval).toEqual({ minutes: 7 });
    expect(serialized.confirmation!.reminders.forget_after.value).toBe("00:02:00");
    expect(alert.runtime).toEqual({ current: 2 });
    expect(alert.confirmation.reminders.interval).toEqual({ minutes: 7 });
    expect(alert.confirmation.reminders.forget_after.value).toBe("00:02:00");
  });

  it("does not validate or rewrite reminder values during canonical serialization", () => {
    const alert = draftAlertFixture();
    alert.confirmation.reminders.interval = { minutes: 7 };
    alert.confirmation.reminders.forget_after.value = "invalid";
    expect(toCanonicalAlert(alert).confirmation!.reminders.forget_after.value).toBe("invalid");
    expect(alert.confirmation.reminders.interval).toEqual({ minutes: 7 });
  });
});