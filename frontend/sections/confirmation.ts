import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { checkedOf, field, section, valueOf } from "../editor/helpers.js";

export function renderConfirmationSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  const buttons = confirmation.buttons;
  const updateButtons = (next: { id: string; label: string }[]): void => {
    confirmation.buttons = next;
    context.markDirty();
    context.refreshStatuses();
  };
  return section(
    "Confirmation",
    html`<div class="nc-grid">
        ${buttons.map(
          (button, index) => html`<div class="nc-confirmation-button-row">
            ${field(
              index === 0 ? "Button ID" : "Button ID (optional)",
              html`<ha-input
                type="text"
                .value=${button.id}
                placeholder="acknowledge"
                @input=${(event: Event) => {
                  button.id = valueOf(event);
                  context.markDirty();
                }}
              ></ha-input>`,
            )}
            ${field(
              index === 0 ? "Button text" : "Button text (optional)",
              html`<ha-input
                type="text"
                .value=${button.label}
                placeholder="Activity completed"
                @input=${(event: Event) => {
                  button.label = valueOf(event);
                  context.markDirty();
                }}
              ></ha-input>`,
            )}
            ${index > 0
              ? html`<button
                  class="nc-button danger"
                  type="button"
                  @click=${() => updateButtons(buttons.filter((_, itemIndex) => itemIndex !== index))}
                >Remove button</button>`
              : ""}
          </div>`,
        )}
        <button
          class="nc-button secondary"
          type="button"
          @click=${() =>
            updateButtons([
              ...buttons,
              { id: `response_${buttons.length + 1}`, label: "" },
            ])}
        >Add response button</button>
      </div>
      <label class="nc-switch-label nc-confirmation-clear">
        <ha-switch
          .checked=${confirmation.notification.clear !== false}
          @change=${(event: Event) => {
            confirmation.notification.clear = checkedOf(event);
            context.markDirty();
          }}
        ></ha-switch>
        <span>Clear notifications when acknowledged</span>
      </label>`,
    "",
    context.activeSection === "Confirmation",
  );
}
