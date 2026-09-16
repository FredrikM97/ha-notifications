import { html } from "lit";
import type { TemplateResult } from "lit";
import { section } from "../editor/helpers.js";

export function renderRecipientSection(): TemplateResult {
  return section(
    "Recipients",
    html`<div data-role="recipients"></div>
      <div class="nc-help">
        Search for a recipient, choose a type when needed, then select it. You
        can mix devices, areas, labels, floors, and notification entities.
      </div>
      <div class="nc-help">
        Selected devices, areas, labels, floors, and notification entities are
        passed to Home Assistant's standard Notify service.
      </div>`,
    "nc-section-recipient",
  );
}
