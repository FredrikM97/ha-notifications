import { html } from "lit";
import type { TemplateResult } from "lit";
import type {
  CodeEditor as CodeEditorElement,
  EditorSectionContext,
} from "../editor/types.js";
import { codeEditor } from "../components/code-editor.js";
import { renderEditorSection } from "../editor/section.js";
import { showTemplateHelp } from "../editor/overlay-events.js";
import { buttonComponent as button } from "../components/button.js";

export function renderConfirmationNotificationSection(
  context: EditorSectionContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return renderEditorSection(
    context.localize("editor.confirmation.notification.section"),
    html`${codeEditor({
        value: String(confirmation.notification.data.message || ""),
        placeholder: "",
        mode: "jinja2",
        language: "jinja",
        label: context.localize("editor.confirmation.message"),
        onInput: (event: Event) => {
          confirmation.notification.data.message = (event.currentTarget as CodeEditorElement).value;
          context.markDirty();
        },
      })}
      <div class="nc-help">
        ${context.localize("editor.confirmation.notification.follow_up_help")}
      </div>
      <div class="nc-help">
        ${context.localize("editor.confirmation.notification.example")} <code>Confirmed by {{confirmed_by}}</code>
      </div>
      <div class="nc-template-help-trigger">
        <span>${context.localize("editor.notification.template_help")}</span>
        ${button({
          label: context.localize("editor.notification.show_template_help"),
          icon: "mdi:information-outline",
          iconOnly: true,
          className: "nc-icon-button",
          onClick: (event: MouseEvent) =>
            showTemplateHelp(
              event,
              context.localize("editor.notification.template_help"),
              html`<div class="nc-help">
          <code>confirmed_by</code>, <code>confirmation_response_id</code>,
          <code>confirmation_response</code>, <code>alert_id</code>,
          <code>alert_name</code>, <code>alert_active</code>,
          <code>trigger</code>, <code>attempt</code>, and <code>now</code> are
          available. Home
          Assistant helpers also work, for example
          <code>states('sensor.temperature')</code>,
          <code>state_attr('light.kitchen', 'brightness')</code>, and
          <code>is_state('binary_sensor.door', 'on')</code>.
        </div>`,
            ),
        })}
      </div>
      `,
    "",
    context.activeSection === "Notify recipients when confirmed",
  );
}
