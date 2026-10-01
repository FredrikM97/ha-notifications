import { css, html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorSectionContext } from "../editor/types.js";
import { checkedValue, formValue } from "../components/form-controls.js";
import { renderFormField } from "../components/form-field.js";
import { renderEditorSection } from "../editor/section.js";
import { buttonComponent as button } from "../components/button.js";

export const confirmationSectionStyles = css`
  .nc-confirmation-controls {
    display: flex;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 8px;
  }

  .nc-confirmation-button-ids > summary {
    display: inline-flex;
    align-items: center;
    border-radius: var(--ha-border-radius-m, 8px);
    padding: 8px 12px;
    border: 1px solid var(--divider-color);
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    list-style: none;
  }

  .nc-confirmation-button-ids > summary::-webkit-details-marker {
    display: none;
  }

  .nc-confirmation-button-id-fields {
    display: grid;
    gap: 12px;
    padding: 12px 0;
  }

  .nc-confirmation-add-button::part(button) {
    justify-self: start;
    border: 1px solid var(--divider-color);
  }

  .nc-confirmation-add-button:hover::part(button) {
    border-color: var(--primary-color);
    background: color-mix(
      in srgb,
      var(--primary-color) 10%,
      var(--secondary-background-color)
    );
  }

  .nc-confirmation-clear {
    margin-top: 16px;
  }
`;

export function renderConfirmationSection(
  context: EditorSectionContext<"refreshStatuses">,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  const buttons = confirmation.buttons;
  const updateButtons = (next: { id?: string; label: string }[]): void => {
    confirmation.buttons = next;
    context.markDirty();
    context.refreshStatuses();
  };
  return renderEditorSection(
    context.localize("editor.confirmation.section"),
    html`<div class="nc-grid">
        ${buttons.map(
          (responseButton, index) => html`<div class="nc-confirmation-button-row">
            ${renderFormField(
              context.localize("editor.confirmation.button_label"),
              html`<ha-input
                type="text"
                .value=${responseButton.label}
                placeholder="Activity completed"
                @input=${(event: Event) => {
                  responseButton.label = formValue(event);
                  context.markDirty();
                }}
              ></ha-input>`,
            )}
            ${index > 0
              ? button({
                  label: context.localize("editor.confirmation.remove_button"),
                  variant: "danger",
                  onClick: () => updateButtons(buttons.filter((_, itemIndex) => itemIndex !== index)),
                })
              : ""}
          </div>`,
        )}
        <div class="nc-confirmation-controls">
          ${button({
            label: context.localize("editor.confirmation.add_response"),
            variant: "secondary",
            className: "nc-confirmation-add-button",
            onClick: () => updateButtons([...buttons, { label: "" }]),
          })}
          <details class="nc-confirmation-button-ids">
            <summary class="nc-button secondary">
              ${context.localize("editor.confirmation.button_ids")}
            </summary>
            <div class="nc-confirmation-button-id-fields">
              ${buttons.map((responseButton, index) =>
                renderFormField(
                  context.localize("editor.confirmation.button_id_for", {
                    index: index + 1,
                  }),
                  html`<ha-input
                    type="text"
                    .value=${responseButton.id || ""}
                    placeholder="acknowledge"
                    @input=${(event: Event) => {
                      const value = formValue(event).trim();
                      responseButton.id = value || undefined;
                      context.markDirty();
                    }}
                  ></ha-input>`,
                ),
              )}
            </div>
          </details>
        </div>
      </div>
      <label class="nc-switch-label nc-confirmation-clear">
        <ha-switch
          .checked=${true}
          @change=${(event: Event) => {
            confirmation.notification.data.clear = checkedValue(event);
            context.markDirty();
          }}
        ></ha-switch>
        <span>${context.localize("editor.confirmation.clear_on_acknowledge")}</span>
      </label>`,
    "",
    context.activeSection === "Confirmation",
    confirmationSectionStyles,
  );
}
