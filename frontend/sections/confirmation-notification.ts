import { html } from "lit";
import type { TemplateResult } from "lit";
import type {
  CodeEditor as CodeEditorElement,
  EditorSectionContext,
} from "../editor/types.js";
import { codeEditor } from "../components/code-editor.js";
import { renderEditorSection } from "../editor/section.js";

export function renderConfirmationNotificationSection(
  context: EditorSectionContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return renderEditorSection(
    context.localize("editor.confirmation.notification.section"),
    html`${codeEditor({
        value: String(confirmation.notification.data.message || ""),
        placeholder: "",
        mode: "jinja2",
        language: "jinja",
        label: context.localize("editor.confirmation.message"),
        onInput: (event: Event) => {
          confirmation.notification.data.message = (event.currentTarget as CodeEditorElement).value;
          context.markDirty();
        },
      })}
      `,
    "",
    context.activeSection === "Notify recipients when confirmed",
  );
}
