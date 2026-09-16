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
        Mobile App notifications when a matching notifier is available.
      </div>`,
  );
}
