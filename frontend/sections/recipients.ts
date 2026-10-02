import { css, html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import { renderEditorSection } from "../editor/section.js";
import type { EditorContext } from "../editor/types.js";

export const recipientSectionStyles = css`
  .nc-section-recipient {
    position: relative;
    z-index: 30;
    overflow: visible;
  }
`;

export function renderRecipientSection(
  context: Pick<EditorContext, "localize" | "activeSection" | "setEditorElement">,
): TemplateResult {
  return renderEditorSection(
    context.localize("editor.recipients.section"),
    html`<div ${ref((element) => context.setEditorElement("recipients", element as HTMLElement))} data-role="recipients"></div>
      `,
    "nc-section-recipient",
    context.activeSection === "Recipients",
    recipientSectionStyles,
  );
}
