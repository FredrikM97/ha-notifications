import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import {
  field,
  optionalControls,
  section,
  valueOf,
} from "../editor/helpers.js";

export function renderConfirmationSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return section(
    "Confirmation",
    html`<div class="nc-grid">
        ${field(
          "Button text",
          html`<input
            type="text"
            .value=${confirmation.button}
            placeholder="Activity completed"
            @input=${(event: Event) => {
              confirmation.button = valueOf(event);
              context.markDirty();
            }}
          />`,
        )}
      </div>
      <div class="nc-help">
        Confirmation buttons require at least one Mobile App recipient.
      </div> `,
    "",
    optionalControls(
      context,
      "confirmation",
      Boolean(confirmation.enabled),
      "confirmation",
      (enabled) => {
        confirmation.enabled = enabled;
        context.markDirty();
      },
    ),
  );
}
