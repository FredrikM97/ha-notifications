import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import { checkedOf, durationInput, durationInputValue, field, section } from "../editor/helpers.js";

export function renderMonitorSection(context: EditorContext): TemplateResult {
  const monitor = context.value.monitor;
  return section(
    "When to check",
    html`<div class="nc-grid">
        ${field(
          "When condition changes",
          html`<div class="nc-check">
            <input
              type="checkbox"
              .checked=${monitor.on_change !== false}
              @change=${(event: Event) => {
                monitor.on_change = checkedOf(event);
                context.markDirty();
                context.refreshStatuses();
              }}
            /><span>When the condition changes</span>
          </div>`,
        )}
        ${field(
          "Re-evaluate condition every",
          html`<div class="nc-check">
              <input
                data-role="interval-toggle"
                type="checkbox"
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
              /><span>Re-evaluate condition every</span>
            </div>
            ${durationInput(
              durationInputValue(monitor.interval, "12:00:00"),
              (next) => {
                monitor.interval = next;
                context.markDirty();
              },
            )}`,
        )}
        ${field(
          "Check at startup",
          html`<div class="nc-check">
            <input
              type="checkbox"
              .checked=${monitor.startup !== false}
              @change=${(event: Event) => {
                monitor.startup = checkedOf(event);
                context.markDirty();
                context.refreshStatuses();
              }}
            /><span>Check when Home Assistant starts</span>
          </div>`,
        )}
      </div>
      <div class="nc-help">
        You can select either method or both. For example, use changes for
        immediate detection and an interval as a safety check.
      </div>`,
  );
}
