import { html } from "lit";
import type { TemplateResult } from "lit";
import { codeEditor } from "../components/code-editor.js";
import type { ActionEditorRole, EditorSectionContext } from "./types.js";
import { actionsYaml } from "./serialization.js";
import { renderEditorSection } from "./section.js";
import { ACTIONS_PLACEHOLDER } from "./types.js";

export function renderActionSection({
  context,
  title,
  help,
  role,
  actions,
}: {
  context: EditorSectionContext<"setEditorControl">;
  title: string;
  help: string;
  role: ActionEditorRole;
  actions: Record<string, unknown>[] | undefined;
}): TemplateResult {
  return renderEditorSection(
    title,
    html`<div class="nc-help">${help}</div>
      ${codeEditor({
        role,
        value: actionsYaml(actions),
        placeholder: ACTIONS_PLACEHOLDER,
        mode: "yaml",
        language: "yaml",
        label: title,
        onInput: () => context.markDirty(),
        onReady: (editor) => context.setEditorControl(role, editor),
      })}`,
    "",
    context.activeSection === title,
  );
}