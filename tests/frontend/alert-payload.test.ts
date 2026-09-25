import { describe, expect, it } from "vitest";
import { buildAlertPayload } from "../../frontend/alert-payload.js";
import {
  alertFormValues,
  alertFormValuesWithRecipients,
  draftAlertFixture,
} from "./conftest.js";

describe("buildAlertPayload", () => {
  it("omits the delivery action when recipients are selected", () => {
    const original = draftAlertFixture({ id: "test_alert" });
    const payload = buildAlertPayload(
      original,
      alertFormValuesWithRecipients(),
    );
    expect(payload).toMatchSnapshot();
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

  it("preserves monitor settings that are not edited", () => {
    const original = draftAlertFixture({
      monitor: {
        ...draftAlertFixture().monitor,
        retention: { enabled: true, days: 14 },
      },
    });
    const payload = buildAlertPayload(
      original,
      alertFormValuesWithRecipients(),
    );

    expect(payload.monitor.retention).toEqual({ enabled: true, days: 14 });
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
        actions: {
          enabled: true,
          items: [{ action: "light.turn_on" }],
        },
      },
    });
    const retained = buildAlertPayload(
      original,
      alertFormValuesWithRecipients({
        confirmation: {
          ...alertFormValues().confirmation,
          actions: { enabled: false },
        },
      }),
    );
    expect(retained.confirmation?.actions).toEqual({
      enabled: false,
      items: [{ action: "light.turn_on" }],
    });

    const cleared = buildAlertPayload(
      original,
      alertFormValuesWithRecipients({
        confirmation: {
          ...alertFormValues().confirmation,
          actions: { enabled: true, items: [] },
        },
      }),
    );
    expect(cleared.confirmation?.actions).toEqual({
      enabled: true,
      items: [],
    });
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

  it("rejects malformed durations before transport", () => {
    const original = draftAlertFixture();
    expect(() =>
      buildAlertPayload(
        original,
        alertFormValues({
          monitor: {
            ...alertFormValues().monitor,
            interval: "not-a-duration",
          },
        }),
        false,
      ),
    ).toThrow("Monitor interval must be a valid duration.");
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
