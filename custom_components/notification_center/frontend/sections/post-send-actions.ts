import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { ACTIONS_PLACEHOLDER } from "../editor/types.js";
import { actionsYaml, codeEditor, optionalControls, section } from "../editor/helpers.js";

export function renderPostSendActionsSection(
  context: EditorContext,
): TemplateResult {
  const notification = context.value.notification;
  return section(
    "Post-send actions",
    html`<div class="nc-help">
        Runs after every notification send. Enter a YAML list of Home Assistant
        actions. JSON arrays also work because JSON is valid YAML.
      </div>
      ${codeEditor({
        role: "notification-actions",
        value: actionsYaml(notification.actions),
        placeholder: ACTIONS_PLACEHOLDER,
        mode: "yaml",
        language: "yaml",
        label: "Post-send actions",
        onInput: () => context.markDirty(),
      })}`,
    "",
    html`<div class="nc-setting-controls">
      <button
        class="nc-button secondary"
        @click=${() =>
          context.validateActions("notification-actions", "Post-send actions")}
      >
        Validate actions
      </button>
      ${optionalControls(
        context,
        "postSendActions",
        Boolean(notification.actions_enabled),
        "post-send actions",
        (enabled) => {
          notification.actions_enabled = enabled;
          context.markDirty();
        },
      )}
    </div>`,
  );
}
