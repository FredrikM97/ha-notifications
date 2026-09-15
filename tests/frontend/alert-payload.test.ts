import { describe, expect, it } from "vitest";
import { buildAlertPayload } from "../../frontend/alert-payload.js";
import type { AlertFormValues } from "../../frontend/alert-payload.js";
import { defaultAlert } from "../../frontend/editor/helpers.js";

function values(overrides: Partial<AlertFormValues> = {}): AlertFormValues {
  return {
    identity: { name: "Front door open", description: "" },
    monitor: {
      conditions: [{ type: "template", template: "{{ true }}" }],
      onChange: true,
      startup: true,
    },
    notification: {
      target: {},
      title: "Alert",
      message: "The front door is open.",
    },
    confirmation: {
      enabled: false,
      button: "",
      notification: { enabled: false, message: "", clear: true },
      reminders: {
        enabled: true,
        interval: "00:30:00",
        max_attempts: 5,
        show_attempts: false,
      },
      actions: { enabled: false, items: [] },
    },
    post_send_actions: { postSendActionsEnabled: false },
    ...overrides,
  };
}

describe("buildAlertPayload", () => {
  it("omits the delivery action when recipients are selected", () => {
    const original = defaultAlert();
    original.id = "test_alert"; // defaultAlert() ids by Date.now(), not snapshot-stable
    const payload = buildAlertPayload(
      original,
      values({
        notification: {
          ...values().notification,
          target: { entity_id: ["notify.mobile_app_phone"] },
        },
      }),
    );
    expect(payload).toMatchSnapshot();
  });

  it("throws when there are no recipients", () => {
    const original = defaultAlert();
    expect(() => buildAlertPayload(original, values())).toThrow(
      /Select at least one device, area, label, or notification entity/,
    );
  });

  it("throws when confirmation is enabled without recipients", () => {
    expect(() =>
      buildAlertPayload(
        defaultAlert(),
        values({
          notification: { ...values().notification, target: {} },
          confirmation: {
            ...values().confirmation,
            enabled: true,
          },
        }),
      ),
    ).toThrow(/Select at least one device, area, label, or notification entity/);
  });
});
