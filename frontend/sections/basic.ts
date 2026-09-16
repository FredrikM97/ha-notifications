import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { field, section, valueOf } from "../editor/helpers.js";

export function renderBasicSection(context: EditorContext): TemplateResult {
  const { value } = context;
  return section(
    "Basic",
    html`<div class="nc-grid">
      ${field(
        "Name",
        html`<ha-input
          appearance="outlined"
          type="text"
          .value=${value.name}
          placeholder="Alert name"
          @input=${(event: Event) => {
            value.name = valueOf(event);
            context.markDirty();
            context.refreshStatuses();
          }}
        ></ha-input>`,
      )}
      ${field(
        "Description",
        html`<textarea
          .value=${value.description}
          @input=${(event: Event) => {
            value.description = valueOf(event);
            context.markDirty();
            context.refreshStatuses();
          }}
        ></textarea>`,
        true,
      )}
      ${field(
        "Icon",
        html`<ha-icon-picker
          .value=${value.icon || "mdi:bell-outline"}
          aria-label="Icon"
          @value-changed=${(event: CustomEvent<{ value: string }>) => {
            value.icon = event.detail.value;
            context.markDirty();
          }}
        ></ha-icon-picker>`,
      )}
    </div>`,
  );
}
