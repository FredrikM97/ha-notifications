import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { Alert } from "../types.js";

export interface EditorModal {
  title: string;
  content: TemplateResult;
  modalClass: string;
  closeLabel: string;
  yaml?: Alert;
}

export function renderEditorModal(
  modal: EditorModal | null,
  onClose: () => void,
): TemplateResult | typeof nothing {
  if (!modal) return nothing;

  return html`<div
      class="nc-modal-backdrop"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section class=${`nc-modal ${modal.modalClass}`} role="dialog" aria-modal="true">
        <header class="nc-modal-header">
          <h2>${modal.title}</h2>
          <button class="nc-icon-button" @click=${onClose} aria-label=${modal.closeLabel} title=${modal.closeLabel}>
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </header>
        <main class="nc-modal-body">${modal.content}</main>
      </section>
    </div>`;
}

export function renderDiscardDialog(
  open: boolean,
  onClose: () => void,
  onDiscard: () => void,
): TemplateResult | typeof nothing {
  if (!open) return nothing;

  return html`<div
      class="nc-modal-backdrop"
      role="presentation"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        class="nc-modal nc-discard-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nc-discard-title"
      >
        <header class="nc-modal-header">
          <h2 id="nc-discard-title">Unsaved changes</h2>
        </header>
        <main class="nc-modal-body">
          <p>You have unsaved changes. Leave without saving?</p>
        </main>
        <footer class="nc-modal-footer">
          <button class="nc-button secondary" @click=${onClose}>
            Stay
          </button>
          <button class="nc-button" @click=${onDiscard}>
            Discard changes
          </button>
        </footer>
      </section>
    </div>`;
}