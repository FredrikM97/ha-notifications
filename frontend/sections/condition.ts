import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { codeEditor, conditionYaml, field, section } from "../editor/helpers.js";

export function renderConditionSection(context: EditorContext): TemplateResult {
  return section(
    context.localize("editor.condition.section"),
    html`<div ${ref((element) => element && context.setEditorElement("conditions-yaml", element as HTMLElement))} data-role="conditions-yaml">
        ${field(
          context.localize("editor.condition.conditions_yaml"),
          codeEditor({
            role: "conditions-yaml-editor",
            value: conditionYaml(context.value.conditions),
            mode: "yaml",
            language: "yaml",
            label: context.localize("editor.condition.conditions_yaml"),
            onInput: () => context.markDirty(),
            onReady: (editor) => context.setEditorControl("conditions-yaml", editor),
          }),
          true,
        )}
        <div class="nc-help">
          ${context.localize("editor.condition.conditions_help")}
        </div>
      </div>
      `,
    "",
    context.activeSection === "Condition",
  );
}
