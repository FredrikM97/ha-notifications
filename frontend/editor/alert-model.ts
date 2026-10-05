import type { Alert, ConfirmationConfig, NotificationTarget } from "../types.js";
import { durationToSeconds, serializeAlertDurations } from "../api.js";

export type EditableAlert = Alert & { confirmation: ConfirmationConfig };
type Trigger = Alert["triggers"][number];

export interface Duration {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export const DEFAULT_INTERVAL_SECONDS = 12 * 3600;

export function defaultAlert(): Alert {
  return {
    id: `alert_${Date.now()}`,
    name: "",
    enabled: true,
    description: "",
    icon: "mdi:bell-outline",
    triggers: [],
    conditions: [],
    automation_mode: "parallel",
    notification: { target: {}, data: { title: "", message: "" } },
    confirmation: {
      enabled: false,
      buttons: [{ id: "confirm", label: "Done" }],
      notification: { enabled: false, data: { message: "" } },
      reminders: {
        enabled: true,
        interval: "00:30:00",
        max_attempts: 5,
        show_attempts: false,
        forget_after_enabled: false,
        timeout: "00:15:00",
      },
      actions: [],
    },
  };
}

export function confirmationNotificationEnabled(
  notification: ConfirmationConfig["notification"],
): boolean {
  if (typeof notification.enabled === "boolean") return notification.enabled;
  return Boolean(
    notification.action ||
      notification.target !== undefined ||
      notification.title !== undefined ||
      notification.message !== undefined ||
      notification.data !== undefined,
  );
}

/** Deep copy with every optional block the editor binds to filled in. */
export function editableAlert(source?: Alert | null): EditableAlert {
  const alert = JSON.parse(JSON.stringify(source || defaultAlert())) as Alert;
  const defaults = defaultAlert().confirmation!;
  const confirmation = { ...defaults, ...alert.confirmation };
  const notification = confirmation.notification || defaults.notification;
  confirmation.notification = {
    ...notification,
    enabled: confirmationNotificationEnabled(notification),
    data: {
      ...notification.data,
      message: String(notification.data?.message ?? notification.message ?? ""),
    },
  };
  confirmation.reminders = { ...defaults.reminders, ...confirmation.reminders };
  confirmation.actions ||= [];
  return { ...alert, confirmation };
}

// ---- Built-in triggers (startup and periodic checks live in alert.triggers) ----

const isStartup = (trigger: Trigger) =>
  trigger.trigger === "homeassistant" && trigger.event === "start";
const isInterval = (trigger: Trigger) => trigger.trigger === "time_pattern";
const isBuiltIn = (trigger: Trigger) => isStartup(trigger) || isInterval(trigger);

export const hasStartupTrigger = (triggers: Trigger[]) => triggers.some(isStartup);
export const intervalTrigger = (triggers: Trigger[]) => triggers.find(isInterval);
export const customTriggers = (triggers: Trigger[]) => triggers.filter((t) => !isBuiltIn(t));

export function setTriggers(
  alert: Alert,
  custom: Trigger[],
  startup: boolean,
  intervalSeconds: number | null,
): void {
  alert.triggers = [
    ...(startup ? [{ trigger: "homeassistant", event: "start" }] : []),
    ...(intervalSeconds === null ? [] : [timePattern(intervalSeconds)]),
    ...custom,
  ];
}

export function intervalSeconds(trigger: Trigger | undefined): number {
  if (!trigger) return DEFAULT_INTERVAL_SECONDS;
  const step = (value: unknown) => Number(String(value).slice(1));
  if (typeof trigger.hours === "string") return step(trigger.hours) * 3600;
  if (trigger.hours === 0 || trigger.hours === "0") return 86400;
  if (typeof trigger.minutes === "string") return step(trigger.minutes) * 60;
  if (typeof trigger.seconds === "string") return step(trigger.seconds);
  return DEFAULT_INTERVAL_SECONDS;
}

function timePattern(total: number): Trigger {
  if (!Number.isFinite(total) || total <= 0) return timePattern(DEFAULT_INTERVAL_SECONDS);
  if (total >= 86400) return { trigger: "time_pattern", hours: 0, minutes: 0, seconds: 0 };
  if (total >= 3600) return { trigger: "time_pattern", hours: `/${Math.min(23, Math.round(total / 3600))}` };
  if (total >= 60) return { trigger: "time_pattern", minutes: `/${Math.min(59, Math.round(total / 60))}` };
  return { trigger: "time_pattern", seconds: `/${total}` };
}

// ---- Durations ----

export function toDuration(value: unknown, fallbackSeconds = 0): Duration {
  let total = durationToSeconds(value as Parameters<typeof durationToSeconds>[0]);
  if (total === undefined) total = fallbackSeconds;
  total = Math.max(0, Math.floor(total));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export const fromDuration = (value: unknown) =>
  durationToSeconds(value as Parameters<typeof durationToSeconds>[0]) ?? 0;

// ---- Saving ----

function hasRecipients(target: NotificationTarget): boolean {
  return Object.values(target).some((values) => Array.isArray(values) && values.length > 0);
}

/** Turn the edited alert into the canonical payload the backend expects. */
export function finalizeAlert(
  draft: EditableAlert,
  postConfirmationActions: boolean,
  validate = true,
): Alert {
  const alert = JSON.parse(JSON.stringify(draft)) as EditableAlert;
  const transient = alert as EditableAlert & {
    condition?: unknown;
    evaluate?: unknown;
  };
  delete transient.runtime;
  delete transient.condition;
  delete transient.evaluate;
  const { confirmation, notification } = alert;
  if (validate) {
    if (!alert.name.trim()) throw new Error("Name is required.");
    if (!hasRecipients(notification.target)) {
      throw new Error("Select at least one device, area, label, or notification entity in Recipients.");
    }
    if (
      confirmation.reminders.forget_after_enabled &&
      (fromDuration(confirmation.reminders.timeout) ?? 0) <= 0
    ) {
      throw new Error("Forget-after duration must be greater than zero.");
    }
  }
  alert.name = alert.name.trim();
  alert.icon = alert.icon?.trim() || "mdi:bell-outline";
  if (confirmation.notification.enabled && !confirmation.notification.target) {
    confirmation.notification.target = notification.target;
  }
  if (!postConfirmationActions) confirmation.actions = [];
  if (alert.post_send_actions && !alert.post_send_actions.enabled && !alert.post_send_actions.actions?.length) {
    delete alert.post_send_actions;
  }
  return serializeAlertDurations(alert);
}
