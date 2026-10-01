import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  className?: string;
  icon?: string;
  title?: string;
  ariaLabel?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  iconOnly?: boolean;
  ariaExpanded?: string;
  dataRole?: string;
  hidden?: boolean;
  onReady?: (element: HTMLElement) => void;
  onClick?: (event: MouseEvent) => void;
}

const BUTTON_TAG = "ha-notifications-button";

export const buttonStyles = css`
  .nc-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: var(--ha-border-radius-m, 8px);
    padding: 8px 12px;
    cursor: pointer;
    background: var(--primary-color);
    color: white;
    font: inherit;
    font-weight: 600;
    text-decoration: none;
  }

  .nc-button.secondary {
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
  }

  .nc-button.danger {
    background: var(--error-color);
    color: white;
  }

  .nc-button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .nc-icon-button {
    display: inline-grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    padding: 0;
    background: transparent;
    color: var(--secondary-text-color);
    cursor: pointer;
  }

  .nc-icon-button:hover {
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
  }

  .nc-icon-button.danger:hover {
    color: var(--error-color);
  }

  .nc-icon-button ha-icon {
    --mdc-icon-size: 20px;
  }
`;

export const buttonComponentStyles = css`
  :host {
    display: inline-block;
    max-width: 100%;
    vertical-align: middle;
  }

  :host([hidden]) {
    display: none;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    max-width: 100%;
    min-height: 36px;
    border: 0;
    border-radius: var(--ha-border-radius-m, 8px);
    padding: 8px 12px;
    background: var(--primary-color);
    color: white;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
  }

  button.secondary {
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
  }

  button.danger {
    background: var(--error-color);
    color: white;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button.icon-only {
    width: 36px;
    height: 36px;
    min-height: 36px;
    padding: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--secondary-text-color);
  }

  button.icon-only:hover {
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
  }

  button.icon-only.danger:hover {
    color: var(--error-color);
  }

  ha-icon {
    --mdc-icon-size: 20px;
    flex: 0 0 auto;
  }
`;

class NotificationsButton extends LitElement {
  static properties = {
    label: { type: String },
    variant: { type: String },
    icon: { type: String },
    className: { type: String },
    title: { type: String },
    ariaLabel: { type: String, attribute: "aria-label" },
    ariaExpanded: { type: String, attribute: "aria-expanded" },
    type: { type: String },
    disabled: { type: Boolean },
    iconOnly: { type: Boolean, attribute: "icon-only" },
    onClick: { attribute: false },
  };

  static styles = buttonComponentStyles;

  declare label: string;
  declare variant: ButtonVariant;
  declare icon: string;
  declare className: string;
  declare title: string;
  declare ariaLabel: string;
  declare ariaExpanded: string;
  declare type: "button" | "submit" | "reset";
  declare disabled: boolean;
  declare iconOnly: boolean;
  declare onClick?: (event: MouseEvent) => void;

  constructor() {
    super();
    this.label = "";
    this.variant = "primary";
    this.icon = "";
    this.className = "";
    this.title = "";
    this.ariaLabel = "";
    this.ariaExpanded = "";
    this.type = "button";
    this.disabled = false;
    this.iconOnly = false;
  }

  protected render() {
    const classes = [
      "nc-button",
      this.variant === "primary" ? "" : this.variant,
      this.iconOnly ? "icon-only" : "",
      this.className,
    ]
      .filter(Boolean)
      .join(" ");
    return html`<button
      part="button"
      class=${classes}
      type=${this.type}
      title=${this.title || this.label}
      aria-label=${this.ariaLabel || this.label}
      aria-expanded=${this.ariaExpanded || nothing}
      ?disabled=${this.disabled}
      @click=${this.onClick}
    >
      ${this.icon ? html`<ha-icon icon=${this.icon} aria-hidden="true"></ha-icon>` : nothing}
      ${this.iconOnly ? nothing : html`<span class="nc-button-label">${this.label}</span>`}
    </button>`;
  }
}

if (!customElements.get(BUTTON_TAG)) {
  customElements.define(BUTTON_TAG, NotificationsButton);
}

export function buttonComponent(options: ButtonOptions): TemplateResult {
  const variant = options.variant ?? "primary";
  const className = [
    "nc-button",
    variant === "primary" ? "" : variant,
    options.className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return html`<ha-notifications-button
    class=${options.className ?? ""}
    .label=${options.label}
    .variant=${variant}
    .icon=${options.icon ?? ""}
    .className=${options.className ?? ""}
    .title=${options.title ?? options.label}
    .ariaLabel=${options.ariaLabel ?? options.label}
    .ariaExpanded=${options.ariaExpanded ?? ""}
    .type=${options.type ?? "button"}
    .disabled=${options.disabled ?? false}
    .iconOnly=${options.iconOnly ?? false}
    .onClick=${options.onClick}
    data-role=${options.dataRole ?? nothing}
    ?hidden=${options.hidden ?? false}
    aria-expanded=${options.ariaExpanded ?? nothing}
    ${ref((element) => element && options.onReady?.(element as HTMLElement))}
  ></ha-notifications-button>`;
}

export function button(options: ButtonOptions): TemplateResult {
  const variant = options.variant ?? "primary";
  const className = [
    "nc-button",
    variant === "primary" ? "" : variant,
    options.className ?? "",
    options.iconOnly ? "nc-icon-button" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return html`<button
    class=${className}
    type=${options.type ?? "button"}
    title=${options.title ?? options.label}
    aria-label=${options.ariaLabel ?? options.label}
    aria-expanded=${options.ariaExpanded ?? nothing}
    data-role=${options.dataRole ?? nothing}
    ?disabled=${options.disabled ?? false}
    ?hidden=${options.hidden ?? false}
    @click=${options.onClick}
  >
    ${options.icon
      ? html`<ha-icon icon=${options.icon} aria-hidden="true"></ha-icon>`
      : nothing}${options.iconOnly ? nothing : html`<span class="nc-button-label">${options.label}</span>`}
  </button>`;
}