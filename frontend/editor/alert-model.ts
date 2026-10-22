import type {
  Alert,
  AlertsConfig,
  DurationValue,
  NotificationTarget,
} from "../types.js";

const UNIT_SECONDS: Record<string, number> = {
  days: 86400,
  hours: 3600,
  minutes: 60,
  seconds: 1,
};

export function durationToSeconds(
  value: DurationValue | undefined,
): number | undefined {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.max(0, value);
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
      Object.entries(UNIT_SECONDS).reduce(
        (sum, [unit, factor]) => sum + (Number(value[unit]) || 0) * factor,
        0,
      ),
    );
  }
  return undefined;
}

export function toCanonicalAlert(alert: Alert): AlertsConfig["alerts"][number] {
  const { runtime: _runtime, ...canonical } = alert;
  return canonical as AlertsConfig["alerts"][number];
}

interface Duration {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

// ---- Durations ----

export function toDuration(value: unknown, fallbackSeconds = 0): Duration {
  let total = durationToSeconds(
    value as Parameters<typeof durationToSeconds>[0],
  );
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
    return (
      Array.isArray(values) &&
      values.some(
        (value) => typeof value === "string" && value.trim().length > 0,
      )
    );
  });
}

/** Turn the edited alert into the canonical payload the backend expects. */
export function finalizeAlert(draft: Alert, validate = true): Alert {
  const alert = draft;
  const { confirmation, notification } = alert;
  if (validate) {
    if (!alert.name.trim()) throw new Error("Name is required.");
    for (const delivery of [notification, confirmation.notification]) {
      if (
        delivery.action !== undefined &&
        !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(delivery.action)
      ) {
        throw new Error("Notification action must be a domain.service name.");
      }
    }
    if (!notification.action && !hasRecipients(notification.target)) {
      throw new Error(
        "Select at least one device, area, label, or notification entity in Recipients.",
      );
    }
    const forgetAfter = confirmation.reminders.forget_after;
    if (forgetAfter.enabled && fromDuration(forgetAfter.value) <= 0) {
      throw new Error("Forget-after duration must be greater than zero.");
    }
  }
  delete alert.runtime;
  alert.name = alert.name.trim();
  alert.icon = alert.icon?.trim() || "mdi:bell-outline";
  if (
    alert.post_send_actions &&
    !alert.post_send_actions.enabled &&
    !alert.post_send_actions.items?.length
  ) {
    delete alert.post_send_actions;
  }
  return alert;
}
