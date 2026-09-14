import type { Alert, AlertCondition, NotificationTarget } from "./types.js";

function cloneAlert(alert: Alert): Alert {
  return JSON.parse(JSON.stringify(alert)) as Alert;
}

export interface AlertFormValues {
  name: string;
  description: string;
  condition: string;
  conditions: AlertCondition[];
  onChange: boolean;
  startup: boolean;
  interval?: string;
  target: NotificationTarget;
  title: string;
  message: string;
  repeat?: {
    interval: string;
    max_attempts: number;
    enabled: boolean;
  };
  actions_enabled: boolean;
  actions?: Record<string, unknown>[];
  confirmation: {
    enabled: boolean;
    button: string;
    completion_message: string;
    notify_on_confirmation: boolean;
    confirmation_message: string;
    clear_on_confirmation: boolean;
    resend_interval: string;
    max_attempts: number;
    actions_enabled: boolean;
    actions?: Record<string, unknown>[];
  };
}

function hasRecipients(target: NotificationTarget): boolean {
  return Object.values(target).some(
    (values) => Array.isArray(values) && values.length > 0,
  );
}

function notificationServiceForTarget(target: NotificationTarget): string {
  return hasRecipients(target) ? "notify.send_message" : "";
}

export function buildAlertPayload(
  original: Alert,
  values: AlertFormValues,
): Alert {
  const result = cloneAlert(original);
  const action =
    notificationServiceForTarget(values.target) ||
    result.notification?.action ||
    "";

  if (!action && !hasRecipients(values.target)) {
    throw new Error(
      "Select at least one device, area, label, or notification entity in Recipients.",
    );
  }

  if (values.confirmation.enabled && !hasRecipients(values.target)) {
    throw new Error(
      "Confirmation requires at least one notification recipient.",
    );
  }

  result.name = values.name.trim();
  result.description = values.description;
  result.conditions = values.conditions;
  result.monitor = {
    on_change: values.onChange,
    startup: values.startup,
  };
  if (values.interval) {
    result.monitor.interval = values.interval;
  }

  result.notification = {
    action,
    target: values.target,
    title: values.title,
    message: values.message,
    actions_enabled: values.actions_enabled,
    confirmation: values.confirmation,
  };

  if (original.notification?.data) {
    result.notification.data = original.notification.data;
  }
  if (values.repeat) {
    result.notification.repeat = values.repeat;
  }
  if (values.actions?.length) {
    result.notification.actions = values.actions;
  }

  return result;
}
