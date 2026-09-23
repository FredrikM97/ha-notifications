import { describe, expect, it } from "vitest";
import { buildAlertPayload } from "../../frontend/alert-payload.js";
import { defaultAlert } from "../../frontend/editor/helpers.js";
import { alertFormValues } from "./conftest.js";

describe("buildAlertPayload", () => {
  it("omits the delivery action when recipients are selected", () => {
    const original = defaultAlert();
    original.id = "test_alert"; // defaultAlert() ids by Date.now(), not snapshot-stable
    const payload = buildAlertPayload(
      original,
      alertFormValues({
        notification: {
          ...alertFormValues().notification,
          target: { entity_id: ["notify.mobile_app_phone"] },
        },
      }),
    );
    expect(payload).toMatchSnapshot();
  });

  it("throws when there are no recipients", () => {
    const original = defaultAlert();
    expect(() => buildAlertPayload(original, alertFormValues())).toThrow(
      /Select at least one device, area, label, or notification entity/,
    );
  });

  it("serializes incomplete drafts for YAML preview", () => {
    const original = defaultAlert();
    original.id = "preview_alert";
    const payload = buildAlertPayload(original, alertFormValues(), false);

    expect(payload).toMatchSnapshot();
  });

  it("does not include runtime state in the editable alert payload", () => {
    const original = defaultAlert();
    original.runtime = {
      active: true,
      confirmation_attempts: 20,
    };
    const payload = buildAlertPayload(
      original,
      alertFormValues({
        notification: {
          ...alertFormValues().notification,
          target: { entity_id: ["notify.mobile_app_phone"] },
        },
      }),
    );

    expect(payload.runtime).toBeUndefined();
  });

  it("persists a custom alert icon", () => {
    const original = defaultAlert();
    original.id = "custom_icon_alert";
    const payload = buildAlertPayload(
      original,
      alertFormValues({
        identity: {
          name: "Front door open",
          description: "",
          icon: "mdi:door-open",
        },
        notification: {
          ...alertFormValues().notification,
          target: { entity_id: ["notify.mobile_app_phone"] },
        },
      }),
    );

    expect(payload).toMatchSnapshot();
  });

  it("serializes confirmation timeout durations for the backend", () => {
    const payload = buildAlertPayload(
      defaultAlert(),
      alertFormValues({
        notification: {
          ...alertFormValues().notification,
          target: { entity_id: ["notify.mobile_app_phone"] },
        },
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
    const original = defaultAlert();
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
        defaultAlert(),
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
