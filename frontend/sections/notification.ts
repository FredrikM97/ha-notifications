import { html } from "lit";
import type { TemplateResult } from "lit";
import type {
  CodeEditor as CodeEditorElement,
  EditorSectionContext,
} from "../editor/types.js";
import { codeEditor } from "../components/code-editor.js";
import { formValue } from "../components/form-controls.js";
import { renderFormField } from "../components/form-field.js";
import { renderEditorSection } from "../editor/section.js";
import { showTemplateHelp } from "../editor/overlay-events.js";
import { buttonComponent as button } from "../components/button.js";

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
          context.localize("editor.notification.message"),
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
              context.localize("editor.notification.templates_help"),
              html`<div class="nc-help">
          Recipients on selected devices, areas, floors, and labels receive
          direct notifications through Home Assistant's standard Notify
          service. Give conditions an ID in the Condition view, then use that
          ID in the message or title to choose text. For example:
          <code>{% if condition.front_door %}Door open{% elif
            condition.garage %}Garage open{% else %}All clear{% endif %}</code>.
        </div>
        <div class="nc-help">
          <code>alert_id</code>, <code>alert_name</code>,
          <code>alert_active</code>, <code>attempt</code>,
          <code>trigger</code>, <code>now</code>, and
          <code>condition.&lt;id&gt;</code> are available here. Home Assistant
          helpers are also available, such as
          <code>states('sensor.temperature')</code>,
          <code>state_attr('light.kitchen', 'brightness')</code>, and
          <code>is_state('binary_sensor.door', 'on')</code>.
        </div>`,
            ),
        })}
      </div>`,
    "",
    context.activeSection === "Notification",
  );
}
