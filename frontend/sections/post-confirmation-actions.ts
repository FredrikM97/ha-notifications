import { html } from "lit";
import type { TemplateResult } from "lit";
import type { ActionEditorSectionContext } from "../editor/types.js";
import { renderActionSection } from "../editor/action-section.js";

export function renderPostConfirmationActionsSection(
  context: ActionEditorSectionContext,
): TemplateResult {
  return renderActionSection({
    context,
    title: context.localize("editor.confirmation.actions.section"),
    help: "",
    role: "post-confirmation-actions",
    actions: context.value.confirmation?.actions,
  });
}
