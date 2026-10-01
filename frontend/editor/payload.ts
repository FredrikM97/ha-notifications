import type {
  Alert,
  AlertCondition,
  NotificationTarget,
} from "../types.js";
import {
  buildAlertPayload,
  type AlertFormValues,
} from "../alert-payload.js";
import { durationInputValue } from "../components/duration-input.js";
import { confirmationNotificationEnabled } from "./confirmation.js";

export interface EditorPayloadInput {
  alert: Alert;
  condition: AlertCondition;
  triggers: Alert["triggers"];
  recipients: NotificationTarget;
  confirmationActions: Record<string, unknown>[];
  postSendActions: Record<string, unknown>[];
  postSendActionsEnabled: boolean;
  postConfirmationActionsEnabled: boolean;
  validate?: boolean;
}

export function buildEditorPayload(input: EditorPayloadInput): Alert {
  const {
    alert,
    condition,
    triggers,
    recipients,
    confirmationActions,
    postSendActions,
    postSendActionsEnabled,
    postConfirmationActionsEnabled,
    validate = true,
  } = input;
  const confirmation = alert.confirmation!;
  const values: AlertFormValues = {
    identity: {
      name: alert.name,
      description: alert.description || "",
      icon: alert.icon,
    },
    evaluate: {
      triggers,
      condition,
    },
    notification: {
      target: recipients,
      title: String(alert.notification.data.title || ""),
      message: String(alert.notification.data.message || ""),
    },
    confirmation: {
      enabled: Boolean(confirmation.enabled),
      buttons: confirmation.buttons,
      notification: {
        enabled: confirmationNotificationEnabled(confirmation.notification),
        message: String(confirmation.notification.data.message || ""),
        clear: true,
      },
      reminders: {
        enabled: confirmation.reminders.enabled,
        interval: durationInputValue(
          confirmation.reminders.interval,
          "00:30:00",
        ),
        max_attempts: confirmation.reminders.max_attempts,
        show_attempts: confirmation.reminders.show_attempts === true,
        forget_after_enabled:
          confirmation.reminders.forget_after_enabled === true,
        timeout: durationInputValue(confirmation.reminders.timeout, "00:15:00"),
      },
      actions: {
        enabled: postConfirmationActionsEnabled,
        items: confirmationActions,
      },
    },
    post_send_actions: {
      postSendActionsEnabled,
      actions: postSendActions,
    },
  };

  return buildAlertPayload(alert, values, validate);
}
