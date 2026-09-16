import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { ACTIONS_PLACEHOLDER } from "../editor/types.js";
import { actionsYaml, codeEditor, section } from "../editor/helpers.js";

export function renderPostSendActionsSection(
  context: EditorContext,
): TemplateResult {
  const postSendActions = context.value.post_send_actions;
  return section(
    "Post-send actions",
    html`<div class="nc-help">
        Runs after every notification send. Enter a YAML list of Home Assistant
        actions. JSON arrays also work because JSON is valid YAML.
      </div>
      ${codeEditor({
        role: "notification-actions",
        value: actionsYaml(postSendActions?.actions),
        placeholder: ACTIONS_PLACEHOLDER,
        mode: "yaml",
        language: "yaml",
        label: "Post-send actions",
        onInput: () => context.markDirty(),
      })}`,
  );
}
