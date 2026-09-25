import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { actionSection } from "../editor/helpers.js";

export function renderPostConfirmationActionsSection(
  context: EditorContext,
): TemplateResult {
  return actionSection({
    context,
    title: "Post-confirmation actions",
    help: "Runs after a recipient confirms. Enter a YAML list of Home Assistant actions. JSON arrays also work because JSON is valid YAML.",
    role: "post-confirmation-actions",
    actions: context.value.confirmation?.actions.items,
  });
}
