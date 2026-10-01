import { describe, expect, it } from "vitest";
import { buildAlertPayload } from "../../frontend/alert-payload.js";
import {
  alertFormValues,
  alertFormValuesWithRecipients,
  draftAlertFixture,
} from "./conftest.js";

describe("buildAlertPayload", () => {
  it("preserves native condition mappings", () => {
    const condition = [
      { condition: "state", entity_id: "binary_sensor.front_door", state: "on" },
      { condition: "template", value_template: "{{ true }}" },
    ];
    const payload = buildAlertPayload(
      draftAlertFixture({ conditions: condition }),
      alertFormValuesWithRecipients({ evaluate: { ...alertFormValues().evaluate, condition } }),
    );
    expect(payload.conditions).toEqual(condition);
    expect(payload).not.toHaveProperty("condition");
  });

  it("preserves native condition durations", () => {
    const condition = [{
      condition: "state",
      entity_id: "binary_sensor.front_door",
      state: "on",
      for: "00:20:00",
    }];
    const payload = buildAlertPayload(
      draftAlertFixture({ conditions: condition }),
      alertFormValuesWithRecipients({
        evaluate: { ...alertFormValues().evaluate, condition },
      }),
    );

    expect(payload.conditions).toEqual(condition);
  });

  it("omits the delivery action when recipients are selected", () => {
    const original = draftAlertFixture({ id: "test_alert" });
    const payload = buildAlertPayload(
      original,
      alertFormValuesWithRecipients(),
    );
    expect(payload).toMatchSnapshot();
  });

  it("keeps confirmation follow-up delivery explicitly disabled by default", () => {
    const payload = buildAlertPayload(
      draftAlertFixture(),
      alertFormValuesWithRecipients({
        confirmation: {
          ...alertFormValues().confirmation,
          notification: { enabled: false, message: "", clear: true },
        },
      }),
    );

    expect(payload.confirmation?.notification.enabled).toBe(false);
    expect(payload.confirmation?.notification.target).toBeUndefined();
  });

  it("throws when there are no recipients", () => {
    const original = draftAlertFixture();
    expect(() => buildAlertPayload(original, alertFormValues())).toThrow(
      /Select at least one device, area, label, or notification entity/,
    );
  });

  it("serializes incomplete drafts for YAML preview", () => {
    const original = draftAlertFixture({ id: "preview_alert" });
    const payload = buildAlertPayload(original, alertFormValues(), false);

    expect(payload).toMatchSnapshot();
  });

  it("does not include runtime state in the editable alert payload", () => {
    const original = draftAlertFixture({
      runtime: { active: true, confirmation_attempts: 20 },
    });
    const payload = buildAlertPayload(
      original,
      alertFormValuesWithRecipients(),
    );

    expect(payload.runtime).toBeUndefined();
  });

  it("persists explicit native triggers", () => {
    const original = draftAlertFixture();
    const payload = buildAlertPayload(
      original,
      alertFormValuesWithRecipients(),
    );

    expect(payload.triggers).toEqual(draftAlertFixture().triggers);
  });

  it("emits canonical triggers without legacy evaluate fields", () => {
    const original = draftAlertFixture();

    const payload = buildAlertPayload(
      original,
      alertFormValuesWithRecipients(),
    );

    expect(payload).not.toHaveProperty("evaluate");
    expect(payload).not.toHaveProperty("condition");
    expect(payload.triggers).toEqual(draftAlertFixture().triggers);
  });

  it("persists disabling existing post-send actions", () => {
    const original = draftAlertFixture({
      post_send_actions: {
        enabled: true,
        actions: [{ action: "light.turn_on" }],
      },
    });
    const payload = buildAlertPayload(
      original,
      alertFormValuesWithRecipients({
        post_send_actions: {
          postSendActionsEnabled: false,
          actions: [],
        },
      }),
    );

    expect(payload.post_send_actions).toEqual({
      enabled: false,
      actions: [{ action: "light.turn_on" }],
    });
  });

  it("clears post-send actions when the enabled editor is emptied", () => {
    const original = draftAlertFixture({
      post_send_actions: {
        enabled: true,
        actions: [{ action: "light.turn_on" }],
      },
    });
    const payload = buildAlertPayload(
      original,
      alertFormValuesWithRecipients({
        post_send_actions: {
          postSendActionsEnabled: true,
          actions: [],
        },
      }),
    );

    expect(payload.post_send_actions).toEqual({ enabled: true, actions: [] });
  });

  it("retains disabled confirmation actions until they are enabled and cleared", () => {
    const original = draftAlertFixture({
      confirmation: {
        ...draftAlertFixture().confirmation!,
        actions: [{ action: "light.turn_on" }],
      },
    });
    const retained = buildAlertPayload(
      original,
      alertFormValuesWithRecipients({
        confirmation: {
          ...alertFormValues().confirmation,
          actions: { enabled: false, items: [] },
        },
      }),
    );
    expect(retained.confirmation?.actions).toEqual([{ action: "light.turn_on" }]);

    const cleared = buildAlertPayload(
      original,
      alertFormValuesWithRecipients({
        confirmation: {
          ...alertFormValues().confirmation,
          actions: { enabled: true, items: [] },
        },
      }),
    );
    expect(cleared.confirmation?.actions).toEqual([]);
  });

  it("persists a custom alert icon", () => {
    const original = draftAlertFixture({ id: "custom_icon_alert" });
    const payload = buildAlertPayload(
      original,
      alertFormValuesWithRecipients({
        identity: {
          name: "Front door open",
          description: "",
          icon: "mdi:door-open",
        },
      }),
    );

    expect(payload).toMatchSnapshot();
  });

  it("serializes confirmation timeout durations for the backend", () => {
    const payload = buildAlertPayload(
      draftAlertFixture(),
      alertFormValuesWithRecipients({
        confirmation: {
          ...alertFormValues().confirmation,
          reminders: {
            ...alertFormValues().confirmation.reminders,
            timeout: "00:15:00",
          },
        },
      }),
    );

    expect(payload.confirmation?.reminders.timeout).toBe(900);
  });

  it("rejects malformed confirmation durations before transport", () => {
    const original = draftAlertFixture();
    expect(() =>
      buildAlertPayload(
        original,
        alertFormValues({
          confirmation: {
            ...alertFormValues().confirmation,
            reminders: {
              ...alertFormValues().confirmation.reminders,
              timeout: "not-a-duration",
            },
          },
        }),
        false,
      ),
    ).toThrow("Confirmation timeout must be a valid duration.");
  });

  it("throws when confirmation is enabled without recipients", () => {
    expect(() =>
      buildAlertPayload(
        draftAlertFixture(),
        alertFormValues({
          notification: { ...alertFormValues().notification, target: {} },
          confirmation: {
            ...alertFormValues().confirmation,
            enabled: true,
          },
        }),
      ),
    ).toThrow(/Select at least one device, area, label, or notification entity/);
  });
});
