import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorSectionContext } from "../editor/types.js";
import { formValue } from "../components/form-controls.js";
import { renderFormField } from "../components/form-field.js";
import { renderEditorSection } from "../editor/section.js";

const DESCRIPTION_SELECTOR_CONFIG = { text: { multiline: true } };

export function renderBasicSection(
  context: EditorSectionContext<"hass" | "refreshStatuses">,
): TemplateResult {
  const { value } = context;
  return renderEditorSection(
    context.localize("editor.basic.section"),
    html`<div class="nc-grid">
      ${renderFormField(
        context.localize("editor.basic.name"),
        html`<ha-input
          type="text"
          .value=${value.name}
          placeholder=${context.localize("editor.basic.alert_name")}
          @input=${(event: Event) => {
            value.name = formValue(event);
            context.markDirty();
            context.refreshStatuses();
          }}
        ></ha-input>`,
      )}
      ${renderFormField(
        context.localize("editor.basic.description"),
        html`<ha-selector
          class="nc-description-input"
          .hass=${context.hass}
          .selector=${DESCRIPTION_SELECTOR_CONFIG}
          aria-label=${context.localize("editor.basic.description")}
          .value=${value.description}
          @value-changed=${(event: CustomEvent<{ value?: string }>) => {
            value.description = event.detail.value || "";
            context.markDirty();
            context.refreshStatuses();
          }}
        ></ha-selector>`,
        true,
      )}
      ${renderFormField(
        context.localize("editor.basic.icon"),
        html`<ha-icon-picker
          .value=${value.icon || "mdi:bell-outline"}
          aria-label=${context.localize("editor.basic.icon")}
          @value-changed=${(event: CustomEvent<{ value: string }>) => {
            value.icon = event.detail.value;
            context.markDirty();
          }}
        ></ha-icon-picker>`,
      )}
    </div>`,
    "",
    context.activeSection === "Basic",
  );
}
