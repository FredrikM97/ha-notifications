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

export function renderMonitorSection(context: EditorContext): TemplateResult {
  const monitor = context.value.monitor;
  return section(
    context.localize("editor.monitor.section"),
    html`<div class="nc-monitor-settings">
      <div class="nc-monitor-toggles">
        <label class="nc-monitor-toggle">
          <ha-switch
            .checked=${monitor.on_change !== false}
            @change=${(event: Event) => {
              monitor.on_change = checkedOf(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-switch>
          <span>${context.localize("editor.monitor.when_condition_changes")}</span>
        </label>
        <label class="nc-monitor-toggle">
          <ha-switch
            .checked=${monitor.clear_on_inactive === true}
            @change=${(event: Event) => {
              monitor.clear_on_inactive = checkedOf(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-switch>
          <span>${context.localize("editor.monitor.clear_when_inactive")}</span>
        </label>
        <label class="nc-monitor-toggle">
          <ha-switch
            .checked=${monitor.startup !== false}
            @change=${(event: Event) => {
              monitor.startup = checkedOf(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-switch>
          <span>${context.localize("editor.monitor.check_startup")}</span>
        </label>
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
          ${context.localize("editor.monitor.re_evaluate_every")}
        </span>`,
        html`<div class="nc-help nc-monitor-help">
            ${context.localize("editor.monitor.interval_help")}
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
      ${field(
        html`<span class="nc-field-heading">
          <ha-switch
            .checked=${monitor.retention?.enabled !== false}
            aria-label=${context.localize("editor.monitor.enable_history_retention")}
            @change=${(event: Event) => {
              monitor.retention = {
                ...monitor.retention,
                enabled: checkedOf(event),
              };
              context.markDirty();
            }}
          ></ha-switch>
          ${context.localize("editor.monitor.history_retention")}
        </span>`,
        retentionTemplate(monitor, context),
      )}
    </div>`,
    "",
    context.activeSection === "When to check",
  );
}

function retentionTemplate(
  monitor: EditorContext["value"]["monitor"],
  context: EditorContext,
): TemplateResult {
  if (monitor.retention?.enabled === false) return html``;
  return html`<div class="nc-help">
      ${context.localize("editor.monitor.retention_help")}
    </div>
    <ha-input
      class="nc-number-field"
      type="number"
      min="1"
      step="1"
      aria-label=${context.localize("editor.monitor.retention_days")}
      .value=${String(monitor.retention?.days || 30)}
      @input=${(event: Event) => {
        monitor.retention = {
          ...monitor.retention,
          enabled: monitor.retention?.enabled,
          days: Math.max(
            1,
            Number((event.currentTarget as HTMLInputElement).value) || 30,
          ),
        };
        context.markDirty();
      }}
    ></ha-input>`;
}
