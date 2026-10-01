/**
 * Shared Lit-rendered toast notifications, used by both the dashboard panel
 * and the alert editor, instead of each building its own ad-hoc DOM node.
 */
import { css, html, LitElement } from "lit";
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

export const toastStyles = css`
  :host {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 20000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }

  .nc-toast {
    max-width: min(480px, calc(100vw - 40px));
    padding: 12px 16px;
    border-radius: 10px;
    background: var(--primary-text-color);
    color: var(--primary-background-color);
    box-shadow: var(--ha-box-shadow);
    overflow-wrap: anywhere;
  }

  .nc-toast.error {
    background: var(--error-color);
    color: white;
  }
`;

class ToastListElement extends LitElement {
  static properties = { toasts: { attribute: false } };
  static styles = toastStyles;

  declare toasts: Toast[];

  constructor() {
    super();
    this.toasts = [];
  }

  protected render() {
    return this.toasts.map(
      (toast) =>
        html`<div class=${toast.error ? "nc-toast error" : "nc-toast"}>
          ${toast.message}
        </div>`,
    );
  }
}

if (!customElements.get("ha-notifications-toast-list")) {
  customElements.define("ha-notifications-toast-list", ToastListElement);
}

export function toastListTemplate(toasts: Toast[]): TemplateResult {
  return html`<ha-notifications-toast-list .toasts=${toasts}></ha-notifications-toast-list>`;
}
