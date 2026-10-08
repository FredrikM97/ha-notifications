import translations from "./translations/en.json";
import type { Hass } from "./types.js";

type TranslationValue = string | { [key: string]: TranslationValue };
type TranslationCatalog = { [key: string]: TranslationValue };

export type Localize = (
  key: string,
  variables?: Record<string, unknown>,
  fallback?: string,
) => string;

export function optionalTranslation(localize: Localize, key?: string): string | undefined {
  if (!key) return undefined;
  const text = localize(key);
  if (!text || text === key) return undefined;
  return text;
}

function catalogValue(key: string): string | undefined {
  let value: TranslationValue | undefined = translations as TranslationCatalog;
  for (const part of key.split(".")) {
    if (typeof value === "string") return undefined;
    if (!value) return undefined;
    value = value[part];
  }
  return typeof value === "string" ? value : undefined;
}

function interpolate(value: string, variables: Record<string, unknown>): string {
  return value.replace(/{{(\w+)}}/g, (_, key: string) => String(variables[key] ?? ""));
}

function resolveLocalized(
  hass: Hass | null | undefined,
  key: string,
  variables: Record<string, unknown> = {},
  fallback?: string,
): string {
  const haKey = `component.ha_notifications.frontend.${key}`;
  const runtimeValue = hass?.localize?.(haKey, variables);
  const value = runtimeValue && runtimeValue !== haKey ? runtimeValue : catalogValue(key);
  return interpolate(value || fallback || key, variables);
}

export function createLocalizer(hass: Hass | null | undefined): Localize {
  return (key, variables = {}, fallback) =>
    resolveLocalized(hass, key, variables, fallback);
}

export function localize(
  hass: Hass | null | undefined,
  key: string,
  variables: Record<string, unknown> = {},
  fallback?: string,
): string {
  return resolveLocalized(hass, key, variables, fallback);
}
