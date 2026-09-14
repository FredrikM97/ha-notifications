import type { TemplateResult } from "lit";
import type { CodeEditor as CodeEditorElement, EditorContext } from "../editor/types.js";
import { codeEditor, confirmationNotificationControls, section } from "../editor/helpers.js";

export function renderConfirmationNotificationSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.notification.confirmation;
  return section(
    "Notify recipients when confirmed",
    codeEditor({
      value: confirmation.confirmation_message || "",
      placeholder: "Confirmed by {{ confirmed_by }}",
      mode: "jinja2",
      language: "jinja",
      label: "Confirmation message",
      onInput: (event: Event) => {
        confirmation.confirmation_message = (
          event.currentTarget as CodeEditorElement
        ).value;
        context.markDirty();
      },
    }),
    "",
    confirmationNotificationControls(context),
  );
}
