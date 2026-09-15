import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { ACTIONS_PLACEHOLDER } from "../editor/types.js";
import { actionsYaml, codeEditor, optionalControls, section } from "../editor/helpers.js";

export function renderPostConfirmationActionsSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return section(
    "Post-confirmation actions",
    html`<div class="nc-help">
        Runs after a recipient confirms. Enter a YAML list of Home Assistant
        actions. JSON arrays also work because JSON is valid YAML.
      </div>
      ${codeEditor({
        role: "actions",
        value: actionsYaml(confirmation.actions.items),
        placeholder: ACTIONS_PLACEHOLDER,
        mode: "yaml",
        language: "yaml",
        label: "Post-confirmation actions",
        onInput: () => context.markDirty(),
      })}`,
    "",
    html`<div class="nc-setting-controls">
      <button
        class="nc-button secondary"
        @click=${() =>
          context.validateActions("actions", "Post-confirmation actions")}
      >
        Validate actions
      </button>
      ${optionalControls(
        context,
        "postConfirmationActions",
        Boolean(confirmation.actions.enabled),
        "post-confirmation actions",
        (enabled) => {
          confirmation.actions.enabled = enabled;
          context.markDirty();
        },
      )}
    </div>`,
  );
}
