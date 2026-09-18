import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import type { CodeEditor as CodeEditorElement, EditorContext } from "../editor/types.js";
import { codeEditor, conditionTemplate, conditionsYaml, field, section } from "../editor/helpers.js";

export function renderConditionSection(context: EditorContext): TemplateResult {
  const condition = conditionTemplate(context.value);
  return section(
    "Condition",
    html`<div class="nc-condition-mode">
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => context.setMode("visual")}
        >
          Visual conditions
        </button>
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => context.setMode("yaml")}
        >
          Conditions YAML
        </button>
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => context.setMode("jinja")}
        >
          Advanced Jinja
        </button>
      </div>
      <div ?hidden=${context.mode !== "visual"} ${ref((element) => element && context.setEditorElement("visual", element as HTMLElement))} data-role="visual" class="nc-condition-visual"></div>
      <div ?hidden=${context.mode !== "yaml"} ${ref((element) => element && context.setEditorElement("conditions-yaml", element as HTMLElement))} data-role="conditions-yaml">
        ${field(
          "Conditions YAML",
          codeEditor({
            role: "conditions-yaml-editor",
            value: conditionsYaml(context.value.conditions),
            mode: "yaml",
            language: "yaml",
            label: "Conditions YAML",
            onInput: () => context.markDirty(),
            onReady: (editor) => context.setEditorControl("conditions-yaml", editor),
          }),
          true,
        )}
        <div class="nc-help">
          Edit the raw <code>conditions:</code> list. This is the YAML behind
          the visual editor.
        </div>
      </div>
      <div ?hidden=${context.mode !== "jinja"} ${ref((element) => element && context.setEditorElement("jinja", element as HTMLElement))} data-role="jinja">
        ${field(
          "Jinja condition",
          codeEditor({
            role: "condition",
            value: condition,
            placeholder: "{{ is_state('binary_sensor.example', 'on') }}",
            mode: "jinja2",
            language: "jinja",
            label: "Jinja condition",
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
          The condition should evaluate to true or false. Home Assistant
          automatically tracks entities referenced by the template.
        </div>
      </div>
      `,
    "",
    context.activeSection === "Condition",
  );
}
