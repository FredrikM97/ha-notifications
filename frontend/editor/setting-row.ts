import { css, html, LitElement } from "lit";
import { mdiInformationOutline } from "@mdi/js";

export interface HelpEntry {
  title?: string;
  text: string;
}

const switchStyles = css`:host { display: inline-flex; flex: none; }`;

const helpStyles = css`
  :host {
    display: inline-flex;
    width: var(--nc-help-width, 32px);
    height: 32px;
    flex: none;
  }

  ha-icon-button {
    --ha-icon-button-size: 32px;
    --mdc-icon-button-size: 32px;
    --mdc-icon-size: 20px;
    color: var(--secondary-text-color);
  }
`;

const styles = css`
  :host {
    display: block;
    min-width: 0;
  }

  .nc-option {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--ha-space-2, 8px);
    min-width: 0;
  }

  .nc-heading {
    display: inline-flex;
    align-items: center;
    gap: var(--ha-space-1, 4px);
    flex: 0 1 auto;
    min-width: 0;
  }

  .nc-heading > span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .nc-heading[hidden] {
    display: none;
  }

  ::slotted([slot="help"]) {
    flex: none;
  }

  ::slotted([slot="toggle"]) {
    flex: none;
    margin-inline-start: auto;
  }

  slot:not([name]) {
    display: contents;
  }
`;

export interface HelpRequestDetail {
  title: string;
  entries: HelpEntry[];
}

export interface EnabledChangedDetail {
  enabled: boolean;
}

export class FeatureSwitch extends LitElement {
  static properties = {
    enabled: { type: Boolean },
    label: { type: String, reflect: true },
  };

  static styles = switchStyles;

  declare enabled: boolean;
  declare label: string;

  constructor() {
    super();
    this.enabled = false;
    this.label = "";
  }

  protected render() {
    return html`<ha-switch .checked=${this.enabled} .disabled=${false} aria-label=${this.label}
      @change=${this.enabledChanged}></ha-switch>`;
  }

  private enabledChanged(event: Event): void {
    this.dispatchEvent(new CustomEvent<EnabledChangedDetail>("enabled-changed", {
      detail: { enabled: (event.currentTarget as HTMLInputElement).checked },
      bubbles: true,
      composed: true,
    }));
  }
}

export class HelpIcon extends LitElement {
  static properties = {
    heading: { type: String },
    moreInfo: { type: String, attribute: "more-info" },
    entries: { attribute: false },
  };

  static styles = helpStyles;

  declare heading: string;
  declare moreInfo: string;
  declare entries: HelpEntry[];

  constructor() {
    super();
    this.heading = "";
    this.moreInfo = "";
    this.entries = [];
  }

  protected willUpdate(): void {
    this.title = `${this.moreInfo}: ${this.heading}`;
  }

  protected render() {
    return html`<ha-icon-button .path=${mdiInformationOutline} .label=${this.title} title=${this.title}
      @click=${this.requestHelp}></ha-icon-button>`;
  }

  private requestHelp(): void {
    this.dispatchEvent(new CustomEvent<HelpRequestDetail>("help-request", {
      detail: { title: this.heading, entries: this.entries },
      bubbles: true,
      composed: true,
    }));
  }
}

export class SettingRow extends LitElement {
  static properties = {
    hasLabel: { state: true },
  };

  static styles = styles;

  declare private hasLabel: boolean;

  constructor() {
    super();
    this.hasLabel = false;
  }

  protected render() {
    return html`<div class="nc-option">
      <slot></slot>
      <span class="nc-heading" ?hidden=${!this.hasLabel}>
        <span><slot name="label" @slotchange=${this.labelChanged}></slot></span><slot name="help"></slot>
      </span>
      <slot name="toggle"></slot>
    </div>`;
  }

  private labelChanged(event: Event): void {
    this.hasLabel = (event.currentTarget as HTMLSlotElement).assignedElements().length > 0;
  }
}

if (!customElements.get("ha-notifications-setting-row")) {
  customElements.define("ha-notifications-setting-row", SettingRow);
}

if (!customElements.get("ha-notifications-help-icon")) {
  customElements.define("ha-notifications-help-icon", HelpIcon);
}

if (!customElements.get("ha-notifications-feature-switch")) {
  customElements.define("ha-notifications-feature-switch", FeatureSwitch);
}