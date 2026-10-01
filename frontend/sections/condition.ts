import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import type { EditorSectionContext } from "../editor/types.js";
import { codeEditor } from "../components/code-editor.js";
import { renderFormField } from "../components/form-field.js";
import { conditionYaml } from "../editor/serialization.js";
import { renderEditorSection } from "../editor/section.js";

export function renderConditionSection(
  context: EditorSectionContext<"setEditorElement" | "setEditorControl">,
): TemplateResult {
  return renderEditorSection(
    context.localize("editor.conditions.section"),
    html`<div ${ref((element) => element && context.setEditorElement("conditions-yaml", element as HTMLElement))} data-role="conditions-yaml">
        ${renderFormField(
          context.localize("editor.conditions.yaml"),
          codeEditor({
            role: "conditions-yaml-editor",
            value: conditionYaml(context.value.conditions),
            mode: "yaml",
            language: "yaml",
            label: context.localize("editor.conditions.yaml"),
            onInput: () => context.markDirty(),
            onReady: (editor) => context.setEditorControl("conditions-yaml", editor),
          }),
          true,
        )}
        <div class="nc-help">
          ${context.localize("editor.conditions.help")}
          <br />
          ${context.localize("editor.conditions.numeric_state_help")}
        </div>
      </div>
      `,
    "",
    context.activeSection === "Conditions",
  );
}
