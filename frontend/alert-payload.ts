import type { Alert, AlertCondition, NotificationTarget } from "./types.js";
import { clone } from "./editor/types.js";

type DurationValue = string | number | Record<string, number>;

export function durationToSeconds(
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

function requiredDurationSeconds(
  value: DurationValue | undefined,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const seconds = durationToSeconds(value);
  if (seconds === undefined) {
    throw new Error(`${field} must be a valid duration.`);
  }
  return seconds;
}

export function serializeAlertDurations(alert: Alert): Alert {
  const result = clone(alert);
  if (result.monitor) {
    const monitorInterval = requiredDurationSeconds(
      result.monitor.interval,
      "Monitor interval",
    );
    if (monitorInterval !== undefined) {
      result.monitor.interval = monitorInterval;
    }
  }

  if (Array.isArray(result.conditions)) {
    result.conditions = result.conditions.map((condition, index) => {
      const conditionFor = requiredDurationSeconds(
        condition.for,
        `Condition ${index + 1} duration`,
      );
      if (conditionFor === undefined) {
        return condition;
      }
      return { ...condition, for: conditionFor };
    });
  }

  if (result.confirmation?.reminders) {
    const interval = requiredDurationSeconds(
      result.confirmation.reminders.interval,
      "Confirmation reminder interval",
    );
    const timeout = requiredDurationSeconds(
      result.confirmation.reminders.timeout,
      "Confirmation timeout",
    );
    result.confirmation = {
      ...result.confirmation,
      reminders: {
        ...result.confirmation.reminders,
        ...(interval === undefined ? {} : { interval }),
        ...(timeout === undefined ? {} : { timeout }),
      },
    };
  }

  return result;
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
  clearOnConditionChange?: boolean;
}

export interface AlertNotificationFormValues {
  target: NotificationTarget;
  title: string;
  message: string;
  clearOnConditionChange?: boolean;
}

export interface AlertConfirmationFormValues {
  enabled: boolean;
  buttons: { id: string; label: string }[];
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
    timeout: string;
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
  validate = true,
): Alert {
  const result = clone(original);
  delete result.runtime;
  if (validate && !hasRecipients(values.notification.target)) {
    throw new Error(
      "Select at least one device, area, label, or notification entity in Recipients.",
    );
  }

  if (
    validate &&
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
  if (values.monitor.clearOnConditionChange !== undefined) {
    result.monitor.clear_on_condition_change =
      values.monitor.clearOnConditionChange;
  }
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

  return serializeAlertDurations(result);
}
