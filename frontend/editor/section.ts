import { css, html, LitElement, nothing, unsafeCSS } from "lit";
import type { CSSResult, TemplateResult } from "lit";
import { button, buttonStyles } from "../components/button.js";

const SECTION_TAG = "ha-notifications-editor-section";

export const editorSectionStyles = css`
  :host {
    display: none;
    min-width: 0;
    margin-bottom: 28px;
    padding: 0 0 28px;
  }

  :host(.active) {
    display: block;
  }

  .content {
    min-width: 0;
  }

  .nc-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 22px;
  }

  .nc-field-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    font-size: 15px;
  }

  .nc-field-heading ha-switch {
    flex: 0 0 auto;
  }

  .nc-switch-label {
    display: flex;
    align-items: center;
    gap: 10px;
    width: fit-content;
    cursor: pointer;
  }

  .nc-help {
    margin-top: 12px;
    color: var(--secondary-text-color);
    font-size: 12px;
    line-height: 1.5;
  }

  .nc-template-help-trigger {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-top: 10px;
    color: var(--secondary-text-color);
    font-size: 12px;
  }

  @container (max-width: 700px) {
    .nc-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 700px) {
    .nc-grid {
      grid-template-columns: 1fr;
    }
  }
`;

class EditorSection extends LitElement {
  static properties = {
    title: { type: String },
    content: { attribute: false },
    featureStyles: { attribute: false },
  };

  static styles = [buttonStyles, editorSectionStyles];

  declare title: string;
  declare content: TemplateResult | typeof nothing;
  declare featureStyles: string;

  constructor() {
    super();
    this.title = "";
    this.content = nothing;
    this.featureStyles = "";
  }

  protected render() {
    return html`${this.featureStyles
        ? html`<style>${unsafeCSS(this.featureStyles)}</style>`
        : nothing}
      <section class="content" data-title=${this.title}>${this.content}</section>`;
  }
}

export function renderHelpTooltip(
  content: string | TemplateResult,
  label: string,
): TemplateResult {
  return renderHelpPopover(content, label);
}

const HELP_TOOLTIP_TAG = "ha-notifications-help-tooltip";
let helpTooltipSequence = 0;

export const helpTooltipStyles = css`
  :host {
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
  }

  .nc-help-tooltip {
    width: 30px;
    height: 30px;
    margin-inline-start: 2px;
  }

  .nc-help-tooltip:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }

  .popup {
    position: fixed;
    inset: auto;
    z-index: 1000;
    display: none;
    width: max-content;
    max-width: min(360px, calc(100vw - 24px));
    max-height: min(55vh, 480px);
    overflow: auto;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--divider-color);
    border-radius: 6px;
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow, 0 8px 24px rgb(0 0 0 / 28%));
    color: var(--primary-text-color);
    font: 400 13px/1.5 var(--primary-font-family, sans-serif);
    overflow-wrap: anywhere;
  }

  .popup:popover-open,
  .popup.fallback-open {
    display: block;
  }

  .popup code {
    white-space: normal;
  }

  .popup > * + * {
    margin-block-start: 8px;
  }

  .popup .nc-help {
    margin: 0;
    color: inherit;
  }
`;

class HelpTooltip extends LitElement {
  static properties = {
    label: { type: String },
    content: { attribute: false },
    tooltipId: { type: String, attribute: false },
  };

  static styles = [buttonStyles, helpTooltipStyles];

  declare label: string;
  declare content: string | TemplateResult;
  declare tooltipId: string;

  private hideTimer = 0;
  private trackingViewport = false;

  constructor() {
    super();
    this.label = "";
    this.content = "";
    this.tooltipId = `nc-help-tooltip-${++helpTooltipSequence}`;
  }

  protected render(): TemplateResult {
    return html`<span
      @pointerenter=${this.showTooltip}
      @pointerleave=${this.scheduleHide}
      @focusin=${this.showTooltip}
      @focusout=${this.scheduleHide}
      @keydown=${this.handleKeydown}
    >
      ${button({
        label: this.label,
        ariaLabel: this.label,
        ariaDescribedBy: this.tooltipId,
        title: "",
        icon: "mdi:information-outline",
        iconOnly: true,
        className: "nc-help-tooltip",
      })}
      <div
        id=${this.tooltipId}
        class="popup"
        role="tooltip"
        popover="manual"
        @pointerenter=${this.showTooltip}
        @pointerleave=${this.scheduleHide}
      >${this.content}</div>
    </span>`;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearTimeout(this.hideTimer);
    this.stopTrackingViewport();
    this.closeTooltip();
  }

  private showTooltip = (): void => {
    window.clearTimeout(this.hideTimer);
    const popup = this.renderRoot.querySelector<HTMLElement>(".popup");
    if (!popup) return;
    const nativePopover = popup as HTMLElement & {
      showPopover?: () => void;
    };
    if (nativePopover.showPopover) {
      try {
        if (!popup.matches(":popover-open")) nativePopover.showPopover();
      } catch {
        popup.classList.add("fallback-open");
      }
    } else {
      popup.classList.add("fallback-open");
    }
    this.positionTooltip();
    if (!this.trackingViewport) {
      window.addEventListener("resize", this.positionTooltip);
      window.addEventListener("scroll", this.positionTooltip, true);
      this.trackingViewport = true;
    }
  };

  private scheduleHide = (): void => {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (!this.isConnected) return;
      if (this.renderRoot.querySelector("button")?.matches(":focus")) return;
      this.closeTooltip();
    }, 120);
  };

  private closeTooltip(): void {
    const popup = this.renderRoot.querySelector<HTMLElement>(".popup");
    if (!popup) return;
    const nativePopover = popup as HTMLElement & {
      hidePopover?: () => void;
    };
    if (nativePopover.hidePopover && popup.matches(":popover-open")) {
      nativePopover.hidePopover();
    }
    popup.classList.remove("fallback-open");
    this.stopTrackingViewport();
  }

  private positionTooltip = (): void => {
    const button = this.renderRoot.querySelector("button");
    const popup = this.renderRoot.querySelector<HTMLElement>(".popup");
    if (!button || !popup) return;
    const triggerRect = button.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const width = Math.min(popupRect.width || popup.scrollWidth, window.innerWidth - 24);
    const height = Math.min(popupRect.height || popup.scrollHeight, window.innerHeight - 24);
    const left = Math.max(
      12,
      Math.min(triggerRect.left + triggerRect.width / 2 - width / 2, window.innerWidth - width - 12),
    );
    const above = triggerRect.top - height - 8;
    const below = triggerRect.bottom + 8;
    const top = above >= 12 || below + height > window.innerHeight - 12
      ? Math.max(12, above)
      : below;
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.min(top, window.innerHeight - height - 12)}px`;
  };

  private stopTrackingViewport(): void {
    if (!this.trackingViewport) return;
    window.removeEventListener("resize", this.positionTooltip);
    window.removeEventListener("scroll", this.positionTooltip, true);
    this.trackingViewport = false;
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    this.closeTooltip();
    this.renderRoot.querySelector<HTMLButtonElement>("button")?.blur();
  };
}

if (!customElements.get(HELP_TOOLTIP_TAG)) {
  customElements.define(HELP_TOOLTIP_TAG, HelpTooltip);
}

function renderHelpPopover(
  content: string | TemplateResult,
  label: string,
): TemplateResult {
  return html`<ha-notifications-help-tooltip
    .content=${content}
    .label=${label}
  ></ha-notifications-help-tooltip>`;
}

export function renderEditorSection(
  title: string,
  content: TemplateResult,
  className = "",
  active = false,
  featureStyles?: CSSResult,
): TemplateResult {
  return html`<ha-notifications-editor-section
    class="nc-section ${className}${active ? " active" : ""}"
    data-title=${title}
    .title=${title}
    .content=${content}
    .featureStyles=${featureStyles?.cssText || ""}
  ></ha-notifications-editor-section>`;
}

if (!customElements.get(SECTION_TAG)) {
  customElements.define(SECTION_TAG, EditorSection);
}