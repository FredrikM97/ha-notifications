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
    "When to check",
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
          <span>When condition changes</span>
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
          <span>Check at startup</span>
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
          Re-evaluate condition every
        </span>`,
        html`<div class="nc-help nc-monitor-help">
            Checks conditions even when no condition-change event is emitted.
          </div>
          <label class="nc-subfield">
          <span>Interval</span>
          ${durationInput(
            durationInputValue(monitor.interval, "12:00:00"),
            (next) => {
              monitor.interval = next;
              context.markDirty();
            },
          )}
        </label>`,
      )}
      ${field(
        html`<span class="nc-field-heading">
          <ha-switch
            .checked=${monitor.retention?.enabled !== false}
            aria-label="Enable history retention"
            @change=${(event: Event) => {
              monitor.retention = {
                ...monitor.retention,
                enabled: checkedOf(event),
              };
              context.markDirty();
            }}
          ></ha-switch>
          History retention
        </span>`,
        monitor.retention?.enabled !== false
          ? html`<label class="nc-subfield">
              <span>Days</span>
              <ha-input
                appearance="outlined"
                class="nc-number-field"
                type="number"
                min="1"
                step="1"
                .value=${String(monitor.retention?.days || 30)}
                @input=${(event: Event) => {
                  monitor.retention = {
                    ...monitor.retention,
                    enabled: monitor.retention?.enabled,
                    days: Math.max(
                      1,
                      Number((event.currentTarget as HTMLInputElement).value) ||
                        30,
                    ),
                  };
                  context.markDirty();
                }}
              ></ha-input>
            </label>`
          : html``,
      )}
    </div>`,
  );
}
