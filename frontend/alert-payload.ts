import type { Alert, AlertCondition, NotificationTarget } from "./types.js";

function cloneAlert(alert: Alert): Alert {
  return JSON.parse(JSON.stringify(alert)) as Alert;
}

function durationToSeconds(
  value: string | number | Record<string, number> | undefined,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string") {
    const parts = value.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return undefined;
    if (parts.length === 2) parts.unshift(0);
    if (parts.length !== 3) return undefined;
    return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  if (value && typeof value === "object") {
    return Math.max(
      0,
      (Number(value.hours) || 0) * 3600 +
        (Number(value.minutes) || 0) * 60 +
        (Number(value.seconds) || 0),
    );
  }
  return undefined;
}

function serializeDurations(result: Alert): void {
  const monitorInterval = durationToSeconds(result.monitor.interval);
  if (monitorInterval !== undefined) result.monitor.interval = monitorInterval;

  result.conditions = result.conditions.map((condition) => ({
    ...condition,
    ...(durationToSeconds(condition.for) !== undefined
      ? { for: durationToSeconds(condition.for) }
      : {}),
  }));

  const resendInterval = durationToSeconds(
    result.confirmation?.reminders.interval,
  );
  if (resendInterval !== undefined && result.confirmation) {
    result.confirmation.reminders.interval = resendInterval;
  }
}

export interface AlertIdentityFormValues {
  name: string;
  description: string;
  icon?: string;
}

export interface AlertMonitorFormValues {
  conditions: AlertCondition[];
  onChange: boolean;
  startup: boolean;
  interval?: string;
}

export interface AlertNotificationFormValues {
  target: NotificationTarget;
  title: string;
  message: string;
}

export interface AlertConfirmationFormValues {
  enabled: boolean;
  button: string;
  notification: {
    enabled: boolean;
    message: string;
    clear: boolean;
  };
  reminders: {
    enabled: boolean;
    interval: string;
    max_attempts: number;
    show_attempts: boolean;
  };
  actions: {
    enabled: boolean;
    items?: Record<string, unknown>[];
  };
}

export interface AlertPostSendActionsFormValues {
  postSendActionsEnabled: boolean;
  actions?: Record<string, unknown>[];
}

export interface AlertFormValues {
  identity: AlertIdentityFormValues;
  monitor: AlertMonitorFormValues;
  notification: AlertNotificationFormValues;
  confirmation: AlertConfirmationFormValues;
  post_send_actions: AlertPostSendActionsFormValues;
}

function hasRecipients(target: NotificationTarget): boolean {
  return Object.values(target).some(
    (values) => Array.isArray(values) && values.length > 0,
  );
}

export function buildAlertPayload(
  original: Alert,
  values: AlertFormValues,
): Alert {
  const result = cloneAlert(original);
  delete result.runtime;
  if (!hasRecipients(values.notification.target)) {
    throw new Error(
      "Select at least one device, area, label, or notification entity in Recipients.",
    );
  }

  if (
    values.confirmation.enabled &&
    !hasRecipients(values.notification.target)
  ) {
    throw new Error(
      "Confirmation requires at least one notification recipient.",
    );
  }

  result.name = values.identity.name.trim();
  result.description = values.identity.description;
  result.icon =
    values.identity.icon?.trim() || result.icon || "mdi:bell-outline";
  result.conditions = values.monitor.conditions;
  result.monitor = {
    on_change: values.monitor.onChange,
    startup: values.monitor.startup,
  };
  if (values.monitor.interval) {
    result.monitor.interval = values.monitor.interval;
  }

  result.notification = {
    target: values.notification.target,
    title: values.notification.title,
    message: values.notification.message,
  };
  result.confirmation = values.confirmation;

  if (original.notification?.data) {
    result.notification.data = original.notification.data;
  }
  if (values.post_send_actions.actions?.length) {
    result.post_send_actions = {
      enabled: values.post_send_actions.postSendActionsEnabled,
      actions: values.post_send_actions.actions,
    };
  } else if (values.post_send_actions.postSendActionsEnabled) {
    result.post_send_actions = { enabled: true };
  }

  serializeDurations(result);

  return result;
}
