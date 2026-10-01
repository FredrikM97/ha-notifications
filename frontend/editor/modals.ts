import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { Alert } from "../types.js";
import type { Localize } from "../localize.js";
import { buttonComponent as button } from "../components/button.js";

export const editorModalStyles = css`
  :host {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: block;
    color: var(--primary-text-color);
  }

  .nc-modal-backdrop {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: auto;
    padding: 24px;
    background: rgb(0 0 0 / 38%);
  }

  .nc-modal {
    width: min(900px, 100%);
    max-height: 92vh;
    overflow: auto;
    background: var(--card-background-color);
    color: var(--primary-text-color);
    border-radius: 18px;
    box-shadow: 0 20px 70px rgba(0, 0, 0, 0.35);
  }

  .nc-alert-yaml-modal {
    width: min(1000px, 100%);
    max-height: 92vh;
    overflow: hidden;
  }

  .nc-alert-yaml-modal .nc-modal-body {
    min-height: 0;
    overflow: hidden;
  }

  .nc-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 0;
    padding: 20px;
    border-bottom: 1px solid var(--divider-color);
    background: var(--secondary-background-color);
  }

  .nc-modal-body {
    padding: 24px;
  }

  .nc-help {
    margin-top: 12px;
    color: var(--secondary-text-color);
    font-size: 12px;
    line-height: 1.5;
  }

  .nc-template-help-modal {
    width: min(560px, 100%);
  }

  @container (max-width: 700px) {
    .nc-modal-body {
      padding: 16px;
    }
  }

  @media (max-width: 700px) {
    .nc-modal-body {
      padding: 16px;
    }
  }
`;

export interface EditorModal {
  title: string;
  content: TemplateResult;
  modalClass: string;
  closeLabel: string;
  yaml?: Alert;
}

const EDITOR_MODAL_TAG = "ha-notifications-editor-modal";

class EditorModalComponent extends LitElement {
  static properties = {
    modal: { attribute: false },
    onClose: { attribute: false },
  };

  static styles = editorModalStyles;

  declare modal: EditorModal | null;
  declare onClose: () => void;

  constructor() {
    super();
    this.modal = null;
    this.onClose = () => undefined;
  }

  protected render(): TemplateResult | typeof nothing {
    const modal = this.modal;
    if (!modal) return nothing;

    return html`<div
        class="nc-modal-backdrop"
        @click=${(event: MouseEvent) => {
          if (event.target === event.currentTarget) this.onClose();
        }}
      >
        <section class=${`nc-modal ${modal.modalClass}`} role="dialog" aria-modal="true">
          <header class="nc-modal-header">
            <h2>${modal.title}</h2>
            ${button({
              label: modal.closeLabel,
              icon: "mdi:close",
              iconOnly: true,
              className: "nc-icon-button",
              onClick: this.onClose,
            })}
          </header>
          <main class="nc-modal-body">${modal.content}</main>
        </section>
      </div>`;
  }
}

if (!customElements.get(EDITOR_MODAL_TAG)) {
  customElements.define(EDITOR_MODAL_TAG, EditorModalComponent);
}

export function renderEditorModal(
  modal: EditorModal | null,
  onClose: () => void,
): TemplateResult | typeof nothing {
  if (!modal) return nothing;

  return html`<ha-notifications-editor-modal
    .modal=${modal}
    .onClose=${onClose}
  ></ha-notifications-editor-modal>`;
}
