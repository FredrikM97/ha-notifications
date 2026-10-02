import type { Alert } from "../types.js";

export function showEditorToast(
  root: ShadowRoot,
  message: string,
  duration = 6000,
): void {
  root.dispatchEvent(
    new CustomEvent("nc-editor-toast", {
      detail: { message, duration },
      bubbles: true,
      composed: true,
    }),
  );
}

export function showYaml(root: ShadowRoot, alert: Alert): void {
  root.dispatchEvent(
    new CustomEvent("nc-editor-modal", {
      detail: { kind: "yaml", alert },
      bubbles: true,
      composed: true,
    }),
  );
}
