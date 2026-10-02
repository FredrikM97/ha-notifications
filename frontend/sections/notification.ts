import { html } from "lit";
import type { TemplateResult } from "lit";
import type {
  CodeEditor as CodeEditorElement,
  EditorSectionContext,
} from "../editor/types.js";
import { codeEditor } from "../components/code-editor.js";
import { formValue } from "../components/form-controls.js";
import { renderFormField } from "../components/form-field.js";
import { renderEditorSection, renderHelpTooltip } from "../editor/section.js";

export function renderNotificationSection(
  context: EditorSectionContext<"refreshStatuses">,
): TemplateResult {
  const notification = context.value.notification;
  return renderEditorSection(
    context.localize("editor.notification.section"),
    html`<div class="nc-grid">
        ${renderFormField(
          context.localize("editor.notification.title"),
          html`<ha-input
            type="text"
            .value=${String(notification.data.title || "")}
            placeholder=${context.localize("editor.notification.title_placeholder")}
            @input=${(event: Event) => {
              notification.data.title = formValue(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-input>`,
        )}
        ${renderFormField(
          html`${context.localize("editor.notification.message")} ${renderHelpTooltip(
            html`<p><strong>${context.localize("editor.notification.condition_text_title")}</strong></p>
              <p>${context.localize("editor.notification.condition_text_help")}</p>
              <p><code>${context.localize("editor.notification.condition_text_example")}</code></p>
              <p><strong>${context.localize("editor.notification.template_values_title")}</strong></p>
              <p>${context.localize("editor.notification.template_values_help")}</p>
              <p><strong>${context.localize("editor.notification.ha_templates_title")}</strong></p>
              <p>${context.localize("editor.notification.ha_templates_help")}</p>`,
            context.localize("editor.notification.show_template_help"),
          )}`,
          codeEditor({
            value: String(notification.data.message || ""),
            placeholder: context.localize("editor.notification.message_placeholder"),
            mode: "jinja2",
            language: "jinja",
            label: context.localize("editor.notification.message_placeholder"),
            onInput: (event: Event) => {
              notification.data.message = (
                event.currentTarget as CodeEditorElement
              ).value;
              context.markDirty();
              context.refreshStatuses();
            },
          }),
          true,
        )}
      </div>
      `,
    "",
    context.activeSection === "Notification",
  );
}
