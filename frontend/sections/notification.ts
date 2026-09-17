import { html } from "lit";
import type { TemplateResult } from "lit";
import type {
  CodeEditor as CodeEditorElement,
  EditorContext,
} from "../editor/types.js";
import { codeEditor, field, section, valueOf } from "../editor/helpers.js";

export function renderNotificationSection(
  context: EditorContext,
): TemplateResult {
  const notification = context.value.notification;
  return section(
    "Notification",
    html`<div class="nc-grid">
        ${field(
          "Title",
          html`<ha-input
            type="text"
            .value=${notification.title}
            placeholder="Notification title"
            @input=${(event: Event) => {
              notification.title = valueOf(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-input>`,
        )}
        ${field(
          "Message",
          codeEditor({
            value: notification.message || "",
            placeholder: "Notification message",
            mode: "jinja2",
            language: "jinja",
            label: "Notification message",
            onInput: (event: Event) => {
              notification.message = (
                event.currentTarget as CodeEditorElement
              ).value;
              context.markDirty();
              context.refreshStatuses();
            },
          }),
          true,
        )}
      </div>
      <div class="nc-help">
        Recipients on selected devices, areas, floors, and labels receive direct
        notifications through Home Assistant's standard Notify service. In the
        message or title, use <code>condition.id</code> and
        <code>trigger</code> to choose text, for example
        <code>{% if condition.front_door %}Door open{% endif %}</code>.
      </div>
      <details class="nc-template-help">
        <summary>Template variables and sensor helpers</summary>
        <div class="nc-help">
          <code>alert_id</code>, <code>alert_name</code>,
          <code>alert_active</code>, <code>attempt</code>,
          <code>trigger</code>, <code>now</code>, and
          <code>condition.&lt;id&gt;</code> are available here. Home Assistant
          helpers are also available, such as
          <code>states('sensor.temperature')</code>,
          <code>state_attr('light.kitchen', 'brightness')</code>, and
          <code>is_state('binary_sensor.door', 'on')</code>.
        </div>
      </details>`,
  );
}
