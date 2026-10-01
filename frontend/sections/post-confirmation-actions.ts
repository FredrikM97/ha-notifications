import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorSectionContext } from "../editor/types.js";
import { renderActionSection } from "../editor/action-section.js";

export function renderPostConfirmationActionsSection(
  context: EditorSectionContext<"setEditorControl">,
): TemplateResult {
  return renderActionSection({
    context,
    title: context.localize("editor.confirmation.actions.section"),
    help: context.localize("editor.confirmation.actions.help"),
    role: "post-confirmation-actions",
    actions: context.value.confirmation?.actions,
  });
}
