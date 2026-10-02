import * as YAML from "yaml";
import type { Alert } from "../types.js";
import { ACTIONS_PLACEHOLDER, type CodeEditor } from "./types.js";

export function conditionYaml(condition: Alert["conditions"]): string {
  return condition.length ? YAML.stringify(condition) : "";
}

export function triggerYaml(triggers: Alert["triggers"]): string {
  return triggers.length ? YAML.stringify(triggers) : "";
}

export function actionsYaml(
  actions: Record<string, unknown>[] | undefined,
): string {
  return actions?.length ? YAML.stringify(actions) : "";
}

export function parseTriggerYaml(value: string): Alert["triggers"] {
  if (!value.trim()) return [];
  const parsed = YAML.parse(value);
  if (
    Array.isArray(parsed) &&
    parsed.every(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    )
  ) {
    return parsed as Alert["triggers"];
  }
  throw new Error("Triggers YAML must be a list of mappings.");
}

export function parseConditionYaml(value: string): Alert["conditions"] {
  if (!value.trim()) return [];
  const parsed = YAML.parse(value);
  if (
    Array.isArray(parsed) &&
    parsed.every(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    )
  ) {
    return parsed as Alert["conditions"];
  }
  throw new Error("Conditions YAML must be a list of mappings.");
}

export function actionArrayValue(
  editor: CodeEditor | null,
  label: string,
): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = YAML.parse(editor?.value || "[]");
  } catch {
    throw new Error(
      `${label} must be a valid YAML list of action objects. Example: ${ACTIONS_PLACEHOLDER}`,
    );
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => item && typeof item === "object")
  ) {
    throw new Error(`${label} must be a YAML list of action objects.`);
  }
  return parsed as Record<string, unknown>[];
}