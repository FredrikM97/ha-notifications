import type { Alert } from "../types.js";

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