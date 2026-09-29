import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import {
  checkedOf,
  durationInput,
  durationInputValue,
  field,
  section,
} from "../editor/helpers.js";

export function renderEvaluateSection(context: EditorContext): TemplateResult {
  const monitor = context.value.monitor || (context.value.monitor = {});
  return section(
    context.localize("editor.evaluate.section"),
    html`<div class="nc-evaluate-settings">
      <div class="nc-evaluate-toggles">
        <label class="nc-evaluate-toggle">
          <ha-switch
            .checked=${monitor.on_change !== false}
            @change=${(event: Event) => {
              monitor.on_change = checkedOf(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-switch>
          <span
            >${context.localize("editor.evaluate.when_condition_changes")}</span
          >
        </label>
        <label class="nc-evaluate-toggle">
          <ha-switch
            .checked=${monitor.clear_on_inactive === true}
            @change=${(event: Event) => {
              monitor.clear_on_inactive = checkedOf(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-switch>
          <span
            >${context.localize("editor.evaluate.clear_when_inactive")}</span
          >
        </label>
        <label class="nc-evaluate-toggle">
          <ha-switch
            .checked=${monitor.startup !== false}
            @change=${(event: Event) => {
              monitor.startup = checkedOf(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-switch>
          <span>${context.localize("editor.evaluate.check_startup")}</span>
        </label>
      </div>
        <div class="nc-help nc-evaluate-help">
          ${context.localize("editor.evaluate.condition_change_help")}
        </div>
      ${field(
        html`<span class="nc-field-heading">
          <ha-switch
            data-role="interval-toggle"
            .checked=${Boolean(monitor.interval)}
            @change=${(event: Event) => {
              const currentInterval = monitor.interval;
              monitor.interval = undefined;
              if (checkedOf(event)) {
                monitor.interval = currentInterval || "12:00:00";
              }
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-switch>
          ${context.localize("editor.evaluate.re_evaluate_every")}
        </span>`,
        html`<div class="nc-help nc-evaluate-help">
            ${context.localize("editor.evaluate.interval_help")}
          </div>
          ${durationInput(
            durationInputValue(monitor.interval, "12:00:00"),
            (next) => {
              monitor.interval = next;
              context.markDirty();
            },
            context.hass,
          )}`,
      )}
    </div>`,
    "",
    context.activeSection === "When to check",
  );
}
