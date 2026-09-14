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

export function renderConfirmationSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.notification.confirmation;
  return section(
    "Confirmation",
    html`<div class="nc-grid">
        ${field(
          "Button text",
          html`<input
            type="text"
            .value=${confirmation.button}
            placeholder="Activity completed"
            @input=${(event: Event) => {
              confirmation.button = valueOf(event);
              context.markDirty();
            }}
          />`,
        )}
        ${field(
          "Completion message",
          html`<textarea
            .value=${confirmation.completion_message || ""}
            @input=${(event: Event) => {
              confirmation.completion_message = valueOf(event);
              context.markDirty();
            }}
          ></textarea>`,
          true,
        )}
        ${field(
          "Confirmation reminder interval",
          durationInput(
            durationInputValue(confirmation.resend_interval, "00:30:00"),
            (next) => {
              confirmation.resend_interval = next;
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
            .value=${String(confirmation.max_attempts || 5)}
            @input=${(event: Event) => {
              confirmation.max_attempts = Math.min(
                20,
                Math.max(1, Number(valueOf(event)) || 5),
              );
              context.markDirty();
            }}
          />`,
        )}
      </div>
      <label class="nc-switch-label nc-confirmation-clear">
        <input
          class="nc-switch-input"
          type="checkbox"
          role="switch"
          .checked=${confirmation.clear_on_confirmation !== false}
          @change=${(event: Event) => {
            confirmation.clear_on_confirmation = checkedOf(event);
            context.markDirty();
          }}
        />
        <span>Clear notifications when acknowledged</span>
      </label>
      <div class="nc-help">
        Confirmation buttons require at least one Mobile App recipient.
      </div> `,
    "",
    optionalControls(
      context,
      "confirmation",
      Boolean(confirmation.enabled),
      "confirmation",
      (enabled) => {
        confirmation.enabled = enabled;
        context.markDirty();
      },
    ),
  );
}
