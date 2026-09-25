import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import { section } from "../editor/helpers.js";
import type { EditorContext } from "../editor/types.js";

export function renderRecipientSection(context: EditorContext): TemplateResult {
  return section(
    context.localize("editor.recipients.section"),
    html`<div ${ref((element) => context.setEditorElement("recipients", element as HTMLElement))} data-role="recipients"></div>
      <div class="nc-help">
        ${context.localize("editor.recipients.help")}
      </div>
      <div class="nc-help">
        ${context.localize("editor.recipients.service_help")}
      </div>`,
    "nc-section-recipient",
    context.activeSection === "Recipients",
  );
}
