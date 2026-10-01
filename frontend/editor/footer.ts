import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { Localize } from "../localize.js";
import { buttonComponent as button } from "../components/button.js";

export const editorFooterStyles = css`
  .nc-discard-confirmation {
    display: flex;
    align-items: center;
    flex: 1 0 100%;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--warning-color, var(--divider-color));
    border-radius: 8px;
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
  }

  .nc-discard-message {
    margin: 0;
    line-height: 1.4;
  }

  .nc-discard-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .nc-modal-footer {
    position: sticky;
    bottom: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    padding: 16px 20px;
    border-top: 1px solid var(--divider-color);
    background: var(--card-background-color);
  }

  .nc-editor-state {
    margin-right: auto;
    color: var(--secondary-text-color);
    font-size: 12px;
  }
`;

export interface EditorFooterOptions {
  localize: Localize;
  onYamlView(): void;
  onClose(): void;
  validationLabel: string;
  onValidate(): void;
  onSave(event: Event): void;
  discardConfirmation: boolean;
  onStay(): void;
  onDiscard(): void;
  dirty: boolean;
}

const EDITOR_FOOTER_TAG = "ha-notifications-editor-footer";

class EditorFooterComponent extends LitElement {
  static properties = {
    localize: { attribute: false },
    onYamlView: { attribute: false },
    onClose: { attribute: false },
    validationLabel: { type: String },
    onValidate: { attribute: false },
    onSave: { attribute: false },
    discardConfirmation: { type: Boolean },
    onStay: { attribute: false },
    onDiscard: { attribute: false },
    dirty: { type: Boolean },
  };

  static styles = editorFooterStyles;

  declare localize: Localize;
  declare onYamlView: () => void;
  declare onClose: () => void;
  declare validationLabel: string;
  declare onValidate: () => void;
  declare onSave: (event: Event) => void;
  declare discardConfirmation: boolean;
  declare onStay: () => void;
  declare onDiscard: () => void;
  declare dirty: boolean;

  protected render(): TemplateResult {
    const {
      onYamlView,
      onClose,
      validationLabel,
      onValidate,
      onSave,
      localize,
      discardConfirmation,
      onStay,
      onDiscard,
      dirty,
    } = this;
    return html`<footer class="nc-modal-footer">
    ${discardConfirmation
      ? html`<div
          class="nc-discard-confirmation"
          role="group"
          aria-label=${localize("editor.common.discard_title")}
        >
          <p class="nc-discard-message">${localize("editor.common.discard_message")}</p>
          <div class="nc-discard-actions">
            ${button({
              label: localize("editor.common.stay"),
              variant: "secondary",
              onClick: onStay,
            })}
            ${button({
              label: localize("editor.common.discard"),
              onClick: onDiscard,
            })}
          </div>
        </div>`
      : nothing}
    <span class="nc-editor-state" aria-live="polite">${dirty ? "Unsaved changes" : "All changes saved"}</span>
    ${button({
      label: localize("editor.common.view_yaml"),
      icon: "mdi:code-braces",
      iconOnly: true,
      className: "nc-icon-button",
      ariaExpanded: "false",
      onClick: onYamlView,
    })}
    ${button({
      label: localize("editor.common.cancel"),
      variant: "secondary",
      onClick: onClose,
    })}
    ${button({
      label: validationLabel,
      variant: "secondary",
      dataRole: "editor-validate",
      hidden: !validationLabel,
      onClick: onValidate,
    })}
    ${button({
      label: localize("editor.common.save_alert"),
      onClick: onSave,
    })}
  </footer>`;
  }

  setDirtyState(dirty: boolean): void {
    this.dirty = dirty;
    this.requestUpdate();
    this.performUpdate();
  }
}

if (!customElements.get(EDITOR_FOOTER_TAG)) {
  customElements.define(EDITOR_FOOTER_TAG, EditorFooterComponent);
}

export function renderEditorFooter(options: EditorFooterOptions): TemplateResult {
  return html`<ha-notifications-editor-footer
    .localize=${options.localize}
    .onYamlView=${options.onYamlView}
    .onClose=${options.onClose}
    .validationLabel=${options.validationLabel}
    .onValidate=${options.onValidate}
    .onSave=${options.onSave}
    .discardConfirmation=${options.discardConfirmation}
    .onStay=${options.onStay}
    .onDiscard=${options.onDiscard}
    .dirty=${options.dirty}
  ></ha-notifications-editor-footer>`;
}