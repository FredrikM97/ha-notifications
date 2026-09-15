import { html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorContext } from "../editor/types.js";
import {
  checkedOf,
  durationInput,
  durationInputValue,
  field,
  optionalControls,
  section,
  valueOf,
} from "../editor/helpers.js";

export function renderConfirmationReminderSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return section(
    "Reminder policy",
    html`<div class="nc-grid">
        ${field(
          "Remind every",
          durationInput(
            durationInputValue(confirmation.reminders.interval, "00:30:00"),
            (next) => {
              confirmation.reminders.interval = next;
              context.markDirty();
            },
          ),
        )}
        ${field(
          "Maximum reminders",
          html`<input
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
          />`,
        )}
      </div>
      <div class="nc-reminder-options">
      <label class="nc-switch-label">
        <input
          class="nc-switch-input"
          type="checkbox"
          role="switch"
          .checked=${confirmation.reminders.show_attempts === true}
          @change=${(event: Event) => {
            confirmation.reminders.show_attempts = checkedOf(event);
            context.markDirty();
          }}
        />
        <span>Show attempt count in notification title</span>
      </label>
      </div>
      <div class="nc-help">
        Resend only while this confirmation is still pending.
      </div>`,
    "",
    optionalControls(
      context,
      "confirmationReminder",
      confirmation.reminders.enabled !== false,
      "reminder policy",
      (enabled) => {
        confirmation.reminders.enabled = enabled;
        context.markDirty();
      },
    ),
  );
}