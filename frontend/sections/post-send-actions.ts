import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { actionSection } from "../editor/helpers.js";

export function renderPostSendActionsSection(
  context: EditorContext,
): TemplateResult {
  const postSendActions = context.value.post_send_actions;
  return actionSection({
    context,
    title: "Post-send actions",
    help: "Runs after every notification send. Enter a YAML list of Home Assistant actions. JSON arrays also work because JSON is valid YAML.",
    role: "post-send-actions",
    actions: postSendActions?.actions,
  });
}
