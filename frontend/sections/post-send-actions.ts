import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorSectionContext } from "../editor/types.js";
import { renderActionSection } from "../editor/action-section.js";

export function renderPostSendActionsSection(
  context: EditorSectionContext<"setEditorControl">,
): TemplateResult {
  const postSendActions = context.value.post_send_actions;
  return renderActionSection({
    context,
    title: context.localize("editor.notification.post_send_actions"),
    help: context.localize("editor.notification.post_send_help"),
    role: "post-send-actions",
    actions: postSendActions?.actions,
  });
}
