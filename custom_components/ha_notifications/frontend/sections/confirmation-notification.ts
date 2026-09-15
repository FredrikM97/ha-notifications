import { html } from "lit";
import type { TemplateResult } from "lit";
import type { CodeEditor as CodeEditorElement, EditorContext } from "../editor/types.js";
import {
  checkedOf,
  codeEditor,
  optionalControls,
  section,
} from "../editor/helpers.js";

export function renderConfirmationNotificationSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return section(
    "Notify recipients when confirmed",
    html`${codeEditor({
        value: confirmation.notification.message || "",
        placeholder: "",
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
      </div>
      `,
    "",
    optionalControls(
      context,
      "confirmationNotification",
      confirmation.notification.enabled === true,
      "confirmation notification",
      (enabled) => {
        confirmation.notification.enabled = enabled;
        context.markDirty();
      },
    ),
  );
}
