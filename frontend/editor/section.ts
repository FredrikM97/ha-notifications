import { css, html, LitElement, nothing, unsafeCSS } from "lit";
import type { CSSResult, TemplateResult } from "lit";

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

  .nc-template-help-trigger .nc-icon-button {
    width: 30px;
    height: 30px;
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

  static styles = editorSectionStyles;

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