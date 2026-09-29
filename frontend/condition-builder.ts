import type { AlertCondition, Hass, Registries } from "./types.js";

export function visualConditionBuilder(
  _container: HTMLElement,
  _hass: Hass,
  _registries: Registries,
  _conditions: AlertCondition[] = [],
  _markDirty: () => void = () => undefined,
): () => AlertCondition[] {
  return () => [];
}
