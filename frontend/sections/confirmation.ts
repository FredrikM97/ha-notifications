import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { EditorSectionContext } from "../editor/types.js";
import { durationInputValue } from "../components/duration-input.js";
import { checkedValue, formValue } from "../components/form-controls.js";
import { renderFormField } from "../components/form-field.js";
import { renderEditorSection, renderHelpTooltip } from "../editor/section.js";
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

  .nc-confirmation-timeout-options {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }

  .nc-confirmation-timeout-field {
    display: grid;
    gap: 8px;
    margin: 0 0 16px;
    max-width: 24rem;
  }

  .nc-confirmation-timeout-control {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .nc-confirmation-timeout-control ha-notifications-duration-input {
    flex: 1;
    min-width: 0;
  }
`;

export function renderConfirmationSection(
  context: EditorSectionContext<"hass" | "refreshStatuses">,
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
    html`<div class="nc-confirmation-timeout-options">
        <label class="nc-switch-label">
          <ha-switch
            .checked=${confirmation.reminders.forget_after_enabled === true}
            aria-label=${context.localize("editor.confirmation.enable_timeout")}
            @change=${(event: Event) => {
              confirmation.reminders.forget_after_enabled = checkedValue(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-switch>
          <span>${context.localize("editor.confirmation.enable_timeout")}</span>
        </label>
        ${renderHelpTooltip(
          context.localize("editor.confirmation.timeout_help"),
          context.localize("editor.common.more_info"),
        )}
      </div>
      ${confirmation.reminders.forget_after_enabled === true
        ? renderFormField(
            context.localize("editor.confirmation.timeout"),
            html`<div class="nc-confirmation-timeout-control">
              <ha-notifications-duration-input
                .hass=${context.hass}
                .value=${durationInputValue(confirmation.reminders.timeout, "00:15:00")}
                aria-label=${context.localize("editor.confirmation.timeout")}
                @nc-duration-change=${(event: CustomEvent<{ value: string }>) => {
                  confirmation.reminders.timeout = event.detail.value;
                  context.markDirty();
                }}
              ></ha-notifications-duration-input>
            </div>`,
            undefined,
            "nc-confirmation-timeout-field",
          )
        : nothing}
      <div class="nc-grid">
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
