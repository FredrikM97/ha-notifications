import { html } from "lit";
import type { TemplateResult } from "lit";
import type { CodeEditor as CodeEditorElement, EditorContext } from "../editor/types.js";
import { codeEditor, section, showTemplateHelp } from "../editor/helpers.js";

export function renderConfirmationNotificationSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return section(
    context.localize("editor.confirmation.notification.section"),
    html`${codeEditor({
        value: confirmation.notification.message || "",
        placeholder: "",
        mode: "jinja2",
        language: "jinja",
        label: context.localize("editor.confirmation.message"),
        onInput: (event: Event) => {
          confirmation.notification.message = (
            event.currentTarget as CodeEditorElement
          ).value;
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
        <button
          class="nc-icon-button"
          type="button"
          aria-label=${context.localize("editor.notification.show_template_help")}
          title=${context.localize("editor.notification.show_template_help")}
          @click=${(event: Event) =>
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
            )}
        >
          <ha-icon icon="mdi:information-outline"></ha-icon>
        </button>
      </div>
      `,
    "",
    context.activeSection === "Notify recipients when confirmed",
  );
}
