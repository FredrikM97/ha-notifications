import { html } from "lit";
import type { TemplateResult } from "lit";

export interface EditorFooterOptions {
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
}: EditorFooterOptions): TemplateResult {
  return html`<footer class="nc-modal-footer">
    <span class="nc-editor-state" aria-live="polite"></span>
    <button
      class="nc-icon-button"
      type="button"
      aria-label="View alert YAML"
      title="View alert YAML"
      aria-expanded="false"
      @click=${onYamlView}
    >
      <ha-icon icon="mdi:code-braces"></ha-icon>
    </button>
    <button class="nc-button secondary" @click=${onClose}>
      Cancel
    </button>
    <button
      class="nc-button secondary"
      data-role="editor-validate"
      @click=${onValidate}
      ?hidden=${!validationLabel}
      aria-label=${validationLabel}
    >${validationLabel}</button>
    <button class="nc-button secondary" @click=${onTest}>
      Test alert
    </button>
    <button class="nc-button" @click=${onSave}>Save alert</button>
  </footer>`;
}