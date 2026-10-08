import type { Alert, AlertsConfig, ConfirmationConfig, DurationValue, NotificationTarget } from "../types.js";

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

function normalizeAlertDurations(alert: Alert): Alert {
  const reminders = alert.confirmation?.reminders;
  if (!reminders) return alert;
  for (const [key, label] of [
    ["interval", "Confirmation reminder interval"],
    ["timeout", "Confirmation timeout"],
  ] as const) {
    if (reminders[key] === undefined) continue;
    const seconds = durationToSeconds(reminders[key] as DurationValue);
    if (seconds === undefined) throw new Error(`${label} must be a valid duration.`);
    reminders[key] = seconds;
  }
  return alert;
}

export function toCanonicalAlert(alert: Alert): AlertsConfig["alerts"][number] {
  const { runtime: _runtime, ...canonical } = normalizeAlertDurations(structuredClone(alert));
  return canonical as AlertsConfig["alerts"][number];
}

export interface EditableAlert extends Alert {
  confirmation: ConfirmationConfig;
}

export interface Duration {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Deep copy with every optional block the editor binds to filled in. */
export function editableAlert(source: Alert | null | undefined, defaults = createAlertDraft()): EditableAlert {
  const alert: EditableAlert = structuredClone({
    ...defaults,
    ...source,
    monitor: {
      ...defaults.monitor,
      ...source?.monitor,
      triggers: { ...defaults.monitor.triggers, ...source?.monitor?.triggers },
      conditions: {
        ...defaults.monitor.conditions,
        ...source?.monitor?.conditions,
        interval: { ...defaults.monitor.conditions.interval, ...source?.monitor?.conditions?.interval },
      },
      inactive: { ...defaults.monitor.inactive, ...source?.monitor?.inactive },
    },
    notification: { ...defaults.notification, ...source?.notification },
    confirmation: {
      ...defaults.confirmation,
      ...source?.confirmation,
      notification: { ...defaults.confirmation.notification, ...source?.confirmation?.notification },
      reminders: { ...defaults.confirmation.reminders, ...source?.confirmation?.reminders },
    },
  });
  // The backend runs actions unless explicitly disabled; show that as an enabled switch.
  if (alert.confirmation.actions.length) alert.confirmation.actions_enabled ??= true;
  return alert;
}

export function createAlertDraft(): EditableAlert {
  const randomId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replaceAll("-", "")
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  return {
    id: `alert_${randomId}`,
    name: "",
    enabled: true,
    description: "",
    icon: "mdi:bell-outline",
    monitor: {
      automation_mode: "parallel",
      triggers: { enabled: true, items: [] },
      conditions: { enabled: true, items: [], startup: false, interval: { enabled: false, value: 43200 } },
      inactive: { enabled: false, items: [], clear_notification: false },
    },
    notification: { target: {}, title: "", message: "", use_default_tag: true, options: {} },
    confirmation: {
      enabled: false,
      buttons: [{ id: "confirm", label: "Done" }],
      notification: { enabled: false, title: "", message: "", use_default_tag: true, options: {} },
      reminders: {
        enabled: true,
        interval: 1800,
        max_attempts: 5,
        show_attempts: false,
        forget_after_enabled: false,
        timeout: 900,
      },
      actions: [],
    },
  };
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

function hasRecipients(target: NotificationTarget | undefined): boolean {
  if (!target) return false;
  return Object.values(target).some((values) => {
    if (typeof values === "string") return values.trim().length > 0;
    return Array.isArray(values) && values.some(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
  });
}

/** Turn the edited alert into the canonical payload the backend expects. */
export function finalizeAlert(draft: EditableAlert, validate = true): Alert {
  const alert = structuredClone(draft);
  delete alert.runtime;
  const { confirmation, notification } = alert;
  if (validate) {
    if (!alert.name.trim()) throw new Error("Name is required.");
    for (const delivery of [notification, confirmation.notification]) {
      if (delivery.action !== undefined && !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(delivery.action)) {
        throw new Error("Notification action must be a domain.service name.");
      }
    }
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
  alert.icon = alert.icon?.trim();
  if (!alert.icon) delete alert.icon;
  if (alert.post_send_actions && !alert.post_send_actions.enabled && !alert.post_send_actions.actions?.length) {
    delete alert.post_send_actions;
  }
  return normalizeAlertDurations(alert);
}
