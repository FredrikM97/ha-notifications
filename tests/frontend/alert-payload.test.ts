import { describe, expect, it } from "vitest";
import { buildAlertPayload } from "../../custom_components/notification_center/frontend/alert-payload.js";
import type { AlertFormValues } from "../../custom_components/notification_center/frontend/alert-payload.js";
import { defaultAlert } from "../../custom_components/notification_center/frontend/editor/helpers.js";

function values(overrides: Partial<AlertFormValues> = {}): AlertFormValues {
  return {
    name: "Front door open",
    description: "",
    condition: "",
    conditions: [{ type: "template", template: "{{ true }}" }],
    onChange: true,
    startup: true,
    target: {},
    title: "Alert",
    message: "The front door is open.",
    actions_enabled: false,
    confirmation: {
      enabled: false,
      button: "",
      completion_message: "",
      notify_on_confirmation: false,
      confirmation_message: "",
      clear_on_confirmation: true,
      resend_interval: "00:30:00",
      max_attempts: 5,
      actions_enabled: false,
    },
    ...overrides,
  };
}

describe("buildAlertPayload", () => {
  it("resolves the generic notify action when recipients are selected", () => {
    const original = defaultAlert();
    original.id = "test_alert"; // defaultAlert() ids by Date.now(), not snapshot-stable
    const payload = buildAlertPayload(
      original,
      values({ target: { entity_id: ["notify.mobile_app_phone"] } }),
    );
    expect(payload.notification.action).toBe("notify.send_message");
    expect(payload).toMatchSnapshot();
  });

  it("throws when there are no recipients and no existing action", () => {
    const original = defaultAlert();
    original.notification.action = "";
    expect(() => buildAlertPayload(original, values())).toThrow(
      /Select at least one device, area, label, or notification entity/,
    );
  });

  it("throws when confirmation is enabled without recipients", () => {
    expect(() =>
      buildAlertPayload(
        defaultAlert(),
        values({
          target: {},
          confirmation: {
            ...values().confirmation,
            enabled: true,
          },
        }),
      ),
    ).toThrow(/Confirmation requires at least one notification recipient/);
  });
});
