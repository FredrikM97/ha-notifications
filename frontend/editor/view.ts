import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorHeaderOptions } from "./header.js";
import type { EditorFooterOptions } from "./footer.js";
import type { EditorOverlayController } from "./overlays.js";
import { toastListTemplate } from "../components/toast.js";
import { renderEditorModal } from "./modals.js";
import {
  renderDiscardConfirmationModal,
  renderEditorFooter,
} from "./footer.js";
import {
  renderEditorHeader,
  renderEditorSectionControls,
} from "./header.js";
import { renderEditorSections } from "./sections.js";

export interface EditorViewOptions {
  header: EditorHeaderOptions;
  footer: EditorFooterOptions;
  overlays: EditorOverlayController;
}

export function renderEditorView(options: EditorViewOptions): TemplateResult {
  const { header, footer, overlays } = options;

  return html`<div class="nc-editor-view">
    <section class="nc-editor-shell">
      ${renderEditorHeader(header)}
      <main class="nc-modal-body">
        <div class="nc-editor-layout">
          ${header.navigation.render(
            header.context.localize,
            header.alert,
            header.activeSectionIndex,
          )}
          <div class="nc-editor-sections">
            ${renderEditorSectionControls(header)}
            ${renderEditorSections(header.context)}
          </div>
        </div>
      </main>
      ${renderEditorFooter(footer)}
    </section>
    ${renderDiscardConfirmationModal(footer)}
    ${renderEditorModal(overlays.currentModal, overlays.closeModal)}${toastListTemplate(
      overlays.currentToasts,
    )}
  </div>`;
}