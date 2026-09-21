import { html } from "lit";
import type { TemplateResult } from "lit";
import type { CodeEditor as CodeEditorElement, EditorContext } from "../editor/types.js";
import { codeEditor, section, showTemplateHelp } from "../editor/helpers.js";

export function renderConfirmationNotificationSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return section(
    "Notify recipients when confirmed",
    html`${codeEditor({
        value: confirmation.notification.message || "",
        placeholder: "",
        mode: "jinja2",
        language: "jinja",
        label: "Confirmation message",
        onInput: (event: Event) => {
          confirmation.notification.message = (
            event.currentTarget as CodeEditorElement
          ).value;
          context.markDirty();
        },
      })}
      <div class="nc-help">
        Optionally send a follow-up message after acknowledgement.
      </div>
      <div class="nc-help">
        Example: <code>Confirmed by {{confirmed_by}}</code>
      </div>
      <div class="nc-template-help-trigger">
        <span>Template variables and sensor helpers</span>
        <button
          class="nc-icon-button"
          type="button"
          aria-label="Show template variables and sensor helpers"
          title="Show template variables and sensor helpers"
          @click=${(event: Event) =>
            showTemplateHelp(
              event,
              "Template variables and sensor helpers",
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
