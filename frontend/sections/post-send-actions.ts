import { html } from "lit";
import type { TemplateResult } from "lit";
import type { ActionEditorSectionContext } from "../editor/types.js";
import { renderActionSection } from "../editor/action-section.js";

export function renderPostSendActionsSection(
  context: ActionEditorSectionContext,
): TemplateResult {
  const postSendActions = context.value.post_send_actions;
  return renderActionSection({
    context,
    title: context.localize("editor.notification.post_send_actions"),
    help: "",
    role: "post-send-actions",
    actions: postSendActions?.actions,
  });
}
