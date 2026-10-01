import { css, html, LitElement } from "lit";
import type { TemplateResult } from "lit";

const FORM_FIELD_TAG = "ha-notifications-form-field";

export const formFieldStyles = css`
  :host {
    display: grid;
    min-width: 0;
    gap: 10px;
  }

  :host(.full) {
    grid-column: 1 / -1;
  }

  .label {
    font-size: 15px;
    font-weight: 600;
  }

  .content {
    display: grid;
    min-width: 0;
    gap: 10px;
  }

  ::slotted(ha-input),
  ::slotted(ha-icon-picker),
  ::slotted(ha-selector),
  ::slotted(ha-notifications-code-editor),
  ::slotted(ha-notifications-duration-input) {
    display: block;
    width: 100%;
    min-width: 0;
  }

  ::slotted(ha-icon-picker) {
    width: min(100%, 14rem);
  }

  ::slotted(ha-input.nc-number-field) {
    width: min(100%, 10rem);
  }
`;

class FormField extends LitElement {
  static styles = formFieldStyles;

  protected render() {
    return html`<div class="label"><slot name="label"></slot></div>
      <div class="content"><slot></slot></div>`;
  }
}

if (!customElements.get(FORM_FIELD_TAG)) {
  customElements.define(FORM_FIELD_TAG, FormField);
}

export function renderFormField(
  label: string | TemplateResult,
  content: TemplateResult = html``,
  full = false,
): TemplateResult {
  return html`<ha-notifications-form-field
    class=${full ? "nc-field full" : "nc-field"}
  >
    <span slot="label">${label}</span>
    ${content}
  </ha-notifications-form-field>`;
}