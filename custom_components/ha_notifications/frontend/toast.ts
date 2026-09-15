/**
 * Shared Lit-rendered toast notifications, used by both the dashboard panel
 * and the alert editor, instead of each building its own ad-hoc DOM node.
 */
import { html } from "lit";
import type { TemplateResult } from "lit";

export interface Toast {
  id: number;
  message: string;
  error: boolean;
}

/** Anything that owns a `toasts` array and can request a Lit re-render. */
export interface ToastHost {
  toasts: Toast[];
  requestUpdate(): void;
}

let nextToastId = 0;

export function showToast(
  host: ToastHost,
  message: string,
  error = false,
  duration = 3500,
): void {
  const toast: Toast = { id: ++nextToastId, message, error };
  host.toasts = [...host.toasts, toast];
  host.requestUpdate();

  window.setTimeout(() => {
    host.toasts = host.toasts.filter((item) => item.id !== toast.id);
    host.requestUpdate();
  }, duration);
}

export function toastListTemplate(toasts: Toast[]): TemplateResult {
  return html`<div class="nc-toast-list">
    ${toasts.map(
      (toast) =>
        html`<div class=${toast.error ? "nc-toast error" : "nc-toast"}>
          ${toast.message}
        </div>`,
    )}
  </div>`;
}
