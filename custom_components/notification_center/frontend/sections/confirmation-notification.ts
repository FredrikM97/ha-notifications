import { html } from "lit";
import type { TemplateResult } from "lit";
import type { CodeEditor as CodeEditorElement, EditorContext } from "../editor/types.js";
import {
  checkedOf,
  codeEditor,
  confirmationNotificationControls,
  childSection,
} from "../editor/helpers.js";

export function renderConfirmationNotificationSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return childSection(
    "Notify recipients when confirmed",
    html`${codeEditor({
        value: confirmation.notification.message || "",
        placeholder: "Confirmed by {{ confirmed_by }}",
        mode: "jinja2",
        language: "jinja",
        label: "Confirmation message",
        onInput: (event: Event) => {
          confirmation.notification.message = (
            event.currentTarget as CodeEditorElement
          ).value;
          context.markDirty();
        },
      })}
      <div class="nc-help">
        Optionally send a follow-up message after acknowledgement.
      </div>`,
    html`${confirmationNotificationControls(context)}
      <label class="nc-switch-label">
        <input
          class="nc-switch-input"
          type="checkbox"
          role="switch"
          .checked=${confirmation.notification.clear !== false}
          @change=${(event: Event) => {
            confirmation.notification.clear = checkedOf(event);
            context.markDirty();
          }}
        />
        <span>Clear notifications when acknowledged</span>
      </label>`,
  );
}
