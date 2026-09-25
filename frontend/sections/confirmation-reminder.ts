import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import {
  checkedOf,
  durationInput,
  durationInputValue,
  field,
  section,
  valueOf,
} from "../editor/helpers.js";

export function renderConfirmationReminderSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return section(
    context.localize("editor.confirmation.reminder.section"),
    html`<div class="nc-grid">
        ${field(
          context.localize("editor.confirmation.reminder.remind_every"),
          durationInput(
            durationInputValue(confirmation.reminders.interval, "00:30:00"),
            (next) => {
              confirmation.reminders.interval = next;
              context.markDirty();
            },
            context.hass,
          ),
        )}
        ${field(
          context.localize("editor.confirmation.reminder.maximum"),
          html`<ha-input
            class="nc-number-field"
            type="number"
            min="1"
            max="20"
            .value=${String(confirmation.reminders.max_attempts || 5)}
            @input=${(event: Event) => {
              confirmation.reminders.max_attempts = Math.min(
                20,
                Math.max(1, Number(valueOf(event)) || 5),
              );
              context.markDirty();
            }}
          ></ha-input>`,
        )}
        ${field(
          context.localize("editor.confirmation.reminder.forget_after"),
          durationInput(
            durationInputValue(confirmation.reminders.timeout, "00:15:00"),
            (next) => {
              confirmation.reminders.timeout = next;
              context.markDirty();
            },
            context.hass,
          ),
        )}
      </div>
      <div class="nc-help">${context.localize("editor.confirmation.reminder.keep_until")}</div>
      <div class="nc-reminder-options">
        <label class="nc-switch-label">
          <ha-switch
            .checked=${confirmation.reminders.show_attempts === true}
            @change=${(event: Event) => {
              confirmation.reminders.show_attempts = checkedOf(event);
              context.markDirty();
            }}
          ></ha-switch>
          <span>${context.localize("editor.confirmation.reminder.show_attempt_count")}</span>
        </label>
      </div>
      </div>`,
    "",
    context.activeSection === "Reminder policy",
  );
}
