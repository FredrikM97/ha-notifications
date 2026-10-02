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
    padding: 24px;
  }

  .nc-editor-section-controls {
    display: flex;
    align-items: center;
    min-height: 40px;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--divider-color);
  }

  .nc-editor-section-control {
    flex: 1;
    min-width: 0;
  }

  .nc-editor-section-control[hidden] {
    display: none;
  }

  @container (max-width: 900px) {
    .nc-editor-view {
      width: 100%;
      max-width: none;
      min-height: 100dvh;
      margin: 0;
      padding: 0;
    }

    .nc-editor-shell {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      border-radius: 0;
      overflow: visible;
    }

    .nc-modal-body {
      display: flex;
      flex: 1;
      padding: 0;
    }

    .nc-editor-layout {
      position: relative;
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    .nc-editor-sections {
      flex: 1;
      padding: 16px;
    }

    .nc-editor-shell {
      overflow: visible;
    }
  }

  @container (max-width: 480px) {
    .nc-editor-view {
      padding-inline: 0;
    }

    .nc-editor-shell {
      border-radius: 0;
    }
  }

  @media (max-width: 900px) {
    .nc-editor-view {
      width: 100%;
      max-width: none;
      min-height: 100dvh;
      margin: 0;
      padding: 0;
    }

    .nc-editor-shell {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      border-radius: 0;
      overflow: visible;
    }

    .nc-modal-body {
      display: flex;
      flex: 1;
      padding: 0;
    }

    .nc-editor-layout {
      display: flex;
      flex-direction: column;
      position: relative;
      flex: 1;
    }

    .nc-editor-sections {
      flex: 1;
      padding: 16px;
    }

    .nc-editor-shell {
      overflow: visible;
    }
  }

  @media (max-width: 480px) {
    .nc-editor-view {
      padding-inline: 0;
    }

    .nc-editor-shell {
      border-radius: 0;
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