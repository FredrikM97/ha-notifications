import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import { section } from "../editor/helpers.js";
import type { EditorContext } from "../editor/types.js";

export function renderRecipientSection(context: EditorContext): TemplateResult {
  return section(
    "Recipients",
    html`<div ${ref((element) => context.setEditorElement("recipients", element as HTMLElement))} data-role="recipients"></div>
      <div class="nc-help">
        Search for a recipient, choose a type when needed, then select it. You
        can mix devices, areas, labels, floors, and notification entities.
      </div>
      <div class="nc-help">
        Selected devices, areas, labels, floors, and notification entities are
        passed to Home Assistant's standard Notify service.
      </div>`,
    "nc-section-recipient",
    context.activeSection === "Recipients",
  );
}
