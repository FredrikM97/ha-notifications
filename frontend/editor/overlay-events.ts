import type { TemplateResult } from "lit";
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

export function showTemplateHelp(
  event: Event,
  title: string,
  content: TemplateResult,
): void {
  const trigger = event.currentTarget as HTMLElement | null;
  const root = trigger?.getRootNode();
  if (!(root instanceof ShadowRoot)) return;

  root.dispatchEvent(
    new CustomEvent("nc-editor-modal", {
      detail: {
        kind: "template-help",
        title,
        content,
        modalClass: "nc-template-help-modal",
        closeLabel: "Close template help",
      },
      bubbles: true,
      composed: true,
    }),
  );
}