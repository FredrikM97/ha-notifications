import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { actionSection } from "../editor/helpers.js";

export function renderPostConfirmationActionsSection(
  context: EditorContext,
): TemplateResult {
  return actionSection({
    context,
    title: context.localize("editor.confirmation.actions.section"),
    help: context.localize("editor.confirmation.actions.help"),
    role: "post-confirmation-actions",
    actions: context.value.confirmation?.actions.items,
  });
}
