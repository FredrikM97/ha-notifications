import { css, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";

const EDITOR_TAG = "ha-notifications-alert-editor";

export const editorComponentStyles = css`
  :host {
    display: block;
    min-width: 0;
    color: var(--primary-text-color);
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  [hidden] {
    display: none !important;
  }

  button,
  input,
  textarea,
  select {
    font: inherit;
  }

  .nc-editor-view {
    width: min(100%, 1440px);
    min-width: 0;
    margin-inline: auto;
    padding: 24px clamp(16px, 3vw, 40px);
  }

  .nc-editor-shell {
    overflow: hidden;
    border-radius: 16px;
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow);
    color: var(--primary-text-color);
  }

  .nc-editor-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 232px;
    grid-template-areas: "content sidebar";
    gap: 28px;
  }

  .nc-editor-sections {
    grid-area: content;
    min-width: 0;
  }

  @container (max-width: 700px) {
    .nc-editor-view {
      padding: 16px;
    }

    .nc-editor-layout {
      position: relative;
      display: block;
    }

    .nc-editor-shell {
      overflow: visible;
    }
  }

  @media (max-width: 700px) {
    .nc-editor-layout {
      display: block;
      position: relative;
    }

    .nc-editor-shell {
      overflow: visible;
    }
  }
`;

export class AlertEditorComponent extends LitElement {
  static styles = editorComponentStyles;

  private view: TemplateResult | typeof nothing = nothing;

  updateView(view: TemplateResult): void {
    this.view = view;
    this.requestUpdate();
    this.performUpdate();
    this.updateNestedComponents(this.shadowRoot);
  }

  protected render(): TemplateResult | typeof nothing {
    return this.view;
  }

  private updateNestedComponents(root: ParentNode | null): void {
    if (!root) return;
    for (const element of root.querySelectorAll("*")) {
      const component = element as HTMLElement & {
        performUpdate?: () => void;
        shadowRoot?: ShadowRoot | null;
      };
      if (component.localName.startsWith("ha-notifications-")) {
        component.performUpdate?.();
      }
      this.updateNestedComponents(component.shadowRoot || null);
    }
  }
}

if (!customElements.get(EDITOR_TAG)) {
  customElements.define(EDITOR_TAG, AlertEditorComponent);
}

export function createAlertEditorComponent(): AlertEditorComponent {
  return document.createElement(EDITOR_TAG) as AlertEditorComponent;
}