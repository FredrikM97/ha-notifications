import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import type { CodeEditor as CodeEditorElement, EditorContext } from "../editor/types.js";
import { codeEditor, conditionTemplate, conditionsYaml, field, section } from "../editor/helpers.js";

export function renderConditionSection(context: EditorContext): TemplateResult {
  const condition = conditionTemplate(context.value);
  return section(
    context.localize("editor.condition.section"),
    html`<div class="nc-condition-mode">
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => context.setMode("visual")}
        >
          ${context.localize("editor.condition.mode_visual")}
        </button>
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => context.setMode("yaml")}
        >
          ${context.localize("editor.condition.mode_yaml")}
        </button>
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => context.setMode("jinja")}
        >
          ${context.localize("editor.condition.mode_jinja")}
        </button>
      </div>
      <div ?hidden=${context.mode !== "visual"} ${ref((element) => element && context.setEditorElement("visual", element as HTMLElement))} data-role="visual" class="nc-condition-visual"></div>
      <div ?hidden=${context.mode !== "yaml"} ${ref((element) => element && context.setEditorElement("conditions-yaml", element as HTMLElement))} data-role="conditions-yaml">
        ${field(
          context.localize("editor.condition.conditions_yaml"),
          codeEditor({
            role: "conditions-yaml-editor",
            value: conditionsYaml(context.value.conditions),
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
      <div ?hidden=${context.mode !== "jinja"} ${ref((element) => element && context.setEditorElement("jinja", element as HTMLElement))} data-role="jinja">
        ${field(
          context.localize("editor.condition.jinja_condition"),
          codeEditor({
            role: "condition",
            value: condition,
            placeholder: "{{ is_state('binary_sensor.example', 'on') }}",
            mode: "jinja2",
            language: "jinja",
            label: context.localize("editor.condition.jinja_condition"),
            onInput: (event: Event) => {
              context.value.conditions = [
                {
                  type: "template",
                  template: (event.currentTarget as CodeEditorElement).value,
                },
              ];
              context.markDirty();
              context.refreshStatuses();
            },
          }),
          true,
        )}
        <div class="nc-help">
          ${context.localize("editor.condition.jinja_help")}
        </div>
      </div>
      `,
    "",
    context.activeSection === "Condition",
  );
}
