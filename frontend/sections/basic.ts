import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { field, section, valueOf } from "../editor/helpers.js";

export function renderBasicSection(context: EditorContext): TemplateResult {
  const { value } = context;
  return section(
    context.localize("editor.basic.section"),
    html`<div class="nc-grid">
      ${field(
        context.localize("editor.basic.name"),
        html`<ha-input
          type="text"
          .value=${value.name}
          placeholder=${context.localize("editor.basic.alert_name")}
          @input=${(event: Event) => {
            value.name = valueOf(event);
            context.markDirty();
            context.refreshStatuses();
          }}
        ></ha-input>`,
      )}
      ${field(
        context.localize("editor.basic.description"),
        html`<ha-selector
          class="nc-description-input"
          .hass=${context.hass}
          .selector=${{ text: { multiline: true } }}
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
      ${field(
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
