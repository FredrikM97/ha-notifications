import { describe, expect, it } from "vitest";
import { confirmationNotificationEnabled, editableAlert, finalizeAlert } from "../../frontend/editor/alert-model.js";
import { draftAlertFixture } from "./conftest.js";

describe("editable alert model", () => {
  it("infers confirmation follow-up state from populated data unless explicitly disabled", () => {
    expect(confirmationNotificationEnabled({ data: {} })).toBe(true);
    expect(confirmationNotificationEnabled({ message: "Done" })).toBe(true);
    expect(confirmationNotificationEnabled({ enabled: false, data: {} })).toBe(false);
  });

  it("fills optional editor blocks without changing native automation data", () => {
    const triggers = [{ trigger: "event", event_type: "door_opened" }];
    const conditions = [{ condition: "template", value_template: "{{ true }}" }];
    const alert = editableAlert(draftAlertFixture({ triggers, conditions }));

    expect(alert.triggers).toEqual(triggers);
    expect(alert.conditions).toEqual(conditions);
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

  it("preserves canonical automation data and strips runtime and obsolete aliases", () => {
    const triggers = [{ trigger: "event", event_type: "door_opened" }];
    const conditions = [{ condition: "state", entity_id: "binary_sensor.door", state: "on" }];
    const draft = editableAlert(draftAlertFixture({
      name: "  Door open  ",
      triggers,
      conditions,
      notification: { target: { entity_id: ["notify.phone"] } },
    }));
    const legacy = draft as typeof draft & { condition: unknown; evaluate: unknown };
    legacy.condition = { condition: "state", entity_id: "legacy.sensor" };
    legacy.evaluate = { condition: [], triggers: [] };
    draft.runtime = { active: true };

    const result = finalizeAlert(draft, false);

    expect(result.name).toBe("Door open");
    expect(result.triggers).toEqual(triggers);
    expect(result.conditions).toEqual(conditions);
    expect(result).not.toHaveProperty("runtime");
    expect(result).not.toHaveProperty("condition");
    expect(result).not.toHaveProperty("evaluate");
  });

  it("keeps confirmation delivery disabled by default and inherits recipients when enabled", () => {
    const disabled = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] } },
    }));
    const disabledResult = finalizeAlert(disabled, false);
    expect(disabledResult.confirmation?.notification.enabled).toBe(false);
    expect(disabledResult.confirmation?.notification.target).toBeUndefined();

    const enabled = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] } },
    }));
    enabled.confirmation!.notification.enabled = true;
    const enabledResult = finalizeAlert(enabled, false);
    expect(enabledResult.confirmation?.notification.target).toEqual({ entity_id: ["notify.phone"] });
  });

  it("includes confirmation actions only when the section is enabled", () => {
    const draft = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] } },
    }));
    draft.confirmation!.actions = [{ action: "light.turn_on" }];

    expect(finalizeAlert(draft, false).confirmation?.actions).toEqual([]);
    expect(finalizeAlert(draft, true).confirmation?.actions).toEqual([{ action: "light.turn_on" }]);
  });

  it("omits empty disabled post-send actions but preserves populated actions", () => {
    const draft = editableAlert(draftAlertFixture({
      name: "Door",
      notification: { target: { entity_id: ["notify.phone"] } },
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