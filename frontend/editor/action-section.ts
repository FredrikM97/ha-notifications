import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { codeEditor } from "../components/code-editor.js";
import type { ActionEditorRole, ActionEditorSectionContext } from "./types.js";
import { actionsYaml } from "./serialization.js";
import { renderEditorSection, renderHelpTooltip } from "./section.js";
import { ACTIONS_PLACEHOLDER } from "./types.js";

export function renderActionSection({
  context,
  title,
  help,
  role,
  actions,
}: {
  context: ActionEditorSectionContext;
  title: string;
  help: string;
  role: ActionEditorRole;
  actions: Record<string, unknown>[] | undefined;
}): TemplateResult {
  return renderEditorSection(
    title,
    html`${help
        ? html`<div class="nc-help">${renderHelpTooltip(
            help,
            context.localize("editor.common.more_info"),
          )}</div>`
        : nothing}
      ${codeEditor({
        role,
        value: actionsYaml(actions),
        hass: context.hass,
        visualType: "action",
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