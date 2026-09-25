import { html } from "lit";
import type { TemplateResult } from "lit";
import type { Localize } from "../localize.js";

export interface EditorFooterOptions {
  localize: Localize;
  onYamlView(): void;
  onClose(): void;
  validationLabel: string;
  onValidate(): void;
  onTest(event: Event): void;
  onSave(event: Event): void;
}

export function renderEditorFooter({
  onYamlView,
  onClose,
  validationLabel,
  onValidate,
  onTest,
  onSave,
  localize,
}: EditorFooterOptions): TemplateResult {
  return html`<footer class="nc-modal-footer">
    <span class="nc-editor-state" aria-live="polite"></span>
    <button
      class="nc-icon-button"
      type="button"
      aria-label=${localize("editor.common.view_yaml")}
      title=${localize("editor.common.view_yaml")}
      aria-expanded="false"
      @click=${onYamlView}
    >
      <ha-icon icon="mdi:code-braces"></ha-icon>
    </button>
    <button class="nc-button secondary" @click=${onClose}>
      ${localize("editor.common.cancel")}
    </button>
    <button
      class="nc-button secondary"
      data-role="editor-validate"
      @click=${onValidate}
      ?hidden=${!validationLabel}
      aria-label=${validationLabel}
    >${validationLabel}</button>
    <button class="nc-button secondary" @click=${onTest}>
      ${localize("alert.test")}
    </button>
    <button class="nc-button" @click=${onSave}>${localize("editor.common.save_alert")}</button>
  </footer>`;
}