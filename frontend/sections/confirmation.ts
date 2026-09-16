import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { checkedOf, field, section, valueOf } from "../editor/helpers.js";

export function renderConfirmationSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return section(
    "Confirmation",
    html`<div class="nc-grid">
        ${field(
          "Button text",
          html`<ha-input
            type="text"
            .value=${confirmation.button}
            placeholder="Activity completed"
            @input=${(event: Event) => {
              confirmation.button = valueOf(event);
              context.markDirty();
            }}
          ></ha-input>`,
        )}
      </div>
      <div class="nc-help">
        Confirmation buttons require at least one Mobile App recipient.
      </div>
      <label class="nc-switch-label">
        <ha-switch
          .checked=${confirmation.notification.clear !== false}
          @change=${(event: Event) => {
            confirmation.notification.clear = checkedOf(event);
            context.markDirty();
          }}
        ></ha-switch>
        <span>Clear notifications when acknowledged</span>
      </label>`,
  );
}
