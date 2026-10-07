import type { Alert, AlertsConfig, ConfirmationConfig, MonitorConfig, NotificationTarget } from "../types.js";

type DurationValue = string | number | Record<string, number>;

const UNIT_SECONDS: Record<string, number> = { days: 86400, hours: 3600, minutes: 60, seconds: 1 };

export function durationToSeconds(value: DurationValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
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
      Object.entries(UNIT_SECONDS).reduce((sum, [unit, factor]) => sum + (Number(value[unit]) || 0) * factor, 0),
    );
  }
  return undefined;
}

export function serializeAlertDurations(alert: Alert): Alert {
  const result = JSON.parse(JSON.stringify(alert)) as Alert;
  const reminders = result.confirmation?.reminders;
  if (!reminders) return result;
  for (const [key, label] of [
    ["interval", "Confirmation reminder interval"],
    ["timeout", "Confirmation timeout"],
  ] as const) {
    if (reminders[key] === undefined) continue;
    const seconds = durationToSeconds(reminders[key] as DurationValue);
    if (seconds === undefined) throw new Error(`${label} must be a valid duration.`);
    reminders[key] = seconds;
  }
  return result;
}

export function toCanonicalAlert(alert: Alert): AlertsConfig["alerts"][number] {
  const { runtime: _runtime, ...canonical } = serializeAlertDurations(alert);
  return canonical as AlertsConfig["alerts"][number];
}

export type EditableAlert = Alert & { confirmation: ConfirmationConfig };
type HaConfig = Record<string, unknown>;
type Trigger = MonitorConfig["triggers"]["items"][number];

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
    monitor: {
      automation_mode: "parallel",
      triggers: { enabled: true, items: [] },
      conditions: { enabled: true, items: [], startup: false, periodic: false, interval: DEFAULT_INTERVAL_SECONDS },
      inactive: { enabled: false, items: [], clear_notification: false },
    },
    notification: { target: {}, title: "", message: "", use_default_tag: true, options: {} },
    confirmation: {
      enabled: false,
      buttons: [{ id: "confirm", label: "Done" }],
      notification: { enabled: false, title: "", message: "", use_default_tag: true, options: {} },
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
  return notification.enabled === true;
}

/** Deep copy with every optional block the editor binds to filled in. */
export function editableAlert(source?: Alert | null): EditableAlert {
  const raw = JSON.parse(JSON.stringify(source || defaultAlert())) as Alert & Record<string, unknown>;
  const alert = raw as Alert;
  alert.notification.use_default_tag ??= true;
  const monitorDefaults = defaultAlert().monitor;
  const triggers = alert.monitor?.triggers;
  alert.monitor = {
    automation_mode: alert.monitor?.automation_mode ?? monitorDefaults.automation_mode,
    triggers: {
      ...monitorDefaults.triggers,
      ...triggers,
      items: triggers?.items ?? [],
    },
    conditions: {
      ...monitorDefaults.conditions,
      ...alert.monitor?.conditions,
      items: alert.monitor?.conditions.items ?? [],
      interval: alert.monitor?.conditions.interval ?? DEFAULT_INTERVAL_SECONDS,
    },
    inactive: {
      ...monitorDefaults.inactive,
      ...alert.monitor?.inactive,
      items: alert.monitor?.inactive?.items ?? [],
    },
  };
  const defaults = defaultAlert().confirmation!;
  const confirmation = { ...defaults, ...alert.confirmation };
  const notification = confirmation.notification || defaults.notification;
  confirmation.notification = {
    ...defaults.notification,
    ...notification,
    enabled: confirmationNotificationEnabled(notification),
    options: { ...notification.options },
  };
  confirmation.reminders = { ...defaults.reminders, ...confirmation.reminders };
  confirmation.actions ||= [];
  return { ...alert, confirmation };
}

export const hasStartupTrigger = (monitor: MonitorConfig) => monitor.conditions.startup;
export const intervalTrigger = (monitor: MonitorConfig) => monitor.conditions.periodic;
export const intervalSeconds = (monitor: MonitorConfig) => durationToSeconds(monitor.conditions.interval) ?? DEFAULT_INTERVAL_SECONDS;
export const customTriggers = (monitor: MonitorConfig) => monitor.triggers.items;

export function setTriggers(
  monitor: MonitorConfig,
  custom: Trigger[],
  startup: boolean,
  intervalSeconds: number | null,
): void {
  monitor.conditions.startup = startup;
  monitor.conditions.periodic = intervalSeconds !== null;
  if (intervalSeconds !== null) monitor.conditions.interval = intervalSeconds;
  monitor.triggers.items = custom;
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
  return Object.values(target).some((values) => {
    if (typeof values === "string") return values.trim().length > 0;
    return Array.isArray(values) && values.some(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
  });
}

/** Turn the edited alert into the canonical payload the backend expects. */
export function finalizeAlert(
  draft: EditableAlert,
  postConfirmationActions: boolean,
  validate = true,
): Alert {
  const alert = JSON.parse(JSON.stringify(draft)) as EditableAlert;
  delete alert.runtime;
  const { confirmation, notification } = alert;
  if (validate) {
    if (!alert.name.trim()) throw new Error("Name is required.");
    if (!notification.action && !hasRecipients(notification.target)) {
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
  if (!postConfirmationActions) confirmation.actions = [];
  if (alert.post_send_actions && !alert.post_send_actions.enabled && !alert.post_send_actions.actions?.length) {
    delete alert.post_send_actions;
  }
  return serializeAlertDurations(alert);
}
