import type {
  Alert,
  AlertCondition,
  NotificationTarget,
} from "../types.js";
import {
  buildAlertPayload,
  type AlertFormValues,
} from "../alert-payload.js";
import { durationInputValue } from "./helpers.js";

export interface EditorPayloadInput {
  alert: Alert;
  conditions: AlertCondition[];
  recipients: NotificationTarget;
  monitorInterval?: string;
  confirmationActions: Record<string, unknown>[];
  postSendActions: Record<string, unknown>[];
  postSendActionsEnabled: boolean;
  postConfirmationActionsEnabled: boolean;
  validate?: boolean;
}

export function buildEditorPayload(input: EditorPayloadInput): Alert {
  const {
    alert,
    conditions,
    recipients,
    monitorInterval,
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
    monitor: {
      conditions,
      onChange: alert.monitor.on_change,
      startup: alert.monitor.startup,
      interval: monitorInterval,
      clearOnInactive: alert.monitor.clear_on_inactive === true,
    },
    notification: {
      target: recipients,
      title: alert.notification.title,
      message: alert.notification.message,
    },
    confirmation: {
      enabled: Boolean(confirmation.enabled),
      buttons: confirmation.buttons,
      notification: {
        enabled: Boolean(confirmation.notification.enabled),
        message: confirmation.notification.message,
        clear: confirmation.notification.clear !== false,
      },
      reminders: {
        enabled: confirmation.reminders.enabled,
        interval: durationInputValue(
          confirmation.reminders.interval,
          "00:30:00",
        ),
        max_attempts: confirmation.reminders.max_attempts,
        show_attempts: confirmation.reminders.show_attempts === true,
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
