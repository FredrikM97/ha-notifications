import { css, html, LitElement } from "lit";

const SETTING_TOGGLE_TAG = "ha-notifications-setting-toggle";

export const settingToggleStyles = css`
  :host {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  ha-switch {
    flex: 0 0 auto;
  }
`;

class SettingToggle extends LitElement {
  static properties = {
    setting: { type: String },
    enabled: { type: Boolean },
    label: { type: String },
    enableText: { type: String, attribute: "enable-text" },
    disableText: { type: String, attribute: "disable-text" },
    disabled: { type: Boolean },
  };

  static styles = settingToggleStyles;

  declare setting: string;
  declare enabled: boolean;
  declare label: string;
  declare enableText: string;
  declare disableText: string;
  declare disabled: boolean;

  constructor() {
    super();
    this.setting = "";
    this.enabled = false;
    this.label = "";
    this.enableText = "Enable";
    this.disableText = "Disable";
    this.disabled = false;
  }

  protected render() {
    const action = this.enabled ? this.disableText : this.enableText;
    const accessibleName = `${action} ${this.label}`;
    return html`<ha-switch
      .checked=${this.enabled}
      ?disabled=${this.disabled}
      aria-label=${accessibleName}
      title=${accessibleName}
      @change=${this.handleChange}
    ></ha-switch>`;
  }

  private handleChange = (event: Event): void => {
    const target = event.currentTarget as HTMLElement & { checked: boolean };
    this.dispatchEvent(
      new CustomEvent("nc-setting-change", {
        detail: { setting: this.setting, enabled: target.checked },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

if (!customElements.get(SETTING_TOGGLE_TAG)) {
  customElements.define(SETTING_TOGGLE_TAG, SettingToggle);
}