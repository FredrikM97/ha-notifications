import type { Alert } from "../types.js";

export const DEFAULT_INTERVAL = "12:00:00";

export function hasStartupTrigger(triggers: Alert["triggers"]): boolean {
  return triggers.some(
    (trigger) =>
      trigger.trigger === "homeassistant" && trigger.event === "start",
  );
}

export function intervalTrigger(
  triggers: Alert["triggers"],
): Record<string, unknown> | undefined {
  return triggers.find((trigger) => trigger.trigger === "time_pattern");
}

export function intervalValue(
  trigger: Record<string, unknown> | undefined,
): string {
  if (!trigger) return DEFAULT_INTERVAL;
  if (typeof trigger.hours === "string") return `${Number(trigger.hours.slice(1))}:00:00`;
  if (trigger.hours === 0 || trigger.hours === "0") return "24:00:00";
  if (typeof trigger.minutes === "string") return `00:${String(Number(trigger.minutes.slice(1))).padStart(2, "0")}:00`;
  if (typeof trigger.seconds === "string") return `00:00:${String(Number(trigger.seconds.slice(1))).padStart(2, "0")}`;
  return DEFAULT_INTERVAL;
}

export function patternForDuration(value: string): Record<string, unknown> {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  const total = hours * 3600 + minutes * 60 + seconds;
  if (!Number.isFinite(total) || total <= 0) {
    return patternForDuration(DEFAULT_INTERVAL);
  }
  if (total >= 86400) return { trigger: "time_pattern", hours: 0, minutes: 0, seconds: 0 };
  if (total >= 3600) {
    return { trigger: "time_pattern", hours: `/${Math.min(23, Math.round(total / 3600))}` };
  }
  if (total >= 60) {
    return { trigger: "time_pattern", minutes: `/${Math.min(59, Math.round(total / 60))}` };
  }
  return { trigger: "time_pattern", seconds: `/${total}` };
}

function isBuiltInTrigger(trigger: Alert["triggers"][number]): boolean {
  return (
    (trigger.trigger === "homeassistant" && trigger.event === "start") ||
    trigger.trigger === "time_pattern"
  );
}

export function customTriggers(
  triggers: Alert["triggers"],
): Alert["triggers"] {
  return triggers.filter((trigger) => !isBuiltInTrigger(trigger));
}

export function mergeCustomTriggers(
  current: Alert["triggers"],
  custom: Alert["triggers"],
): Alert["triggers"] {
  return [...current.filter(isBuiltInTrigger), ...custom];
}