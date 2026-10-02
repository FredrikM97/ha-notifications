import { css, html } from "lit";
import type { TemplateResult } from "lit";
import type { EditorSectionContext } from "../editor/types.js";
import { durationInputValue } from "../components/duration-input.js";
import { checkedValue, formValue } from "../components/form-controls.js";
import { renderFormField } from "../components/form-field.js";
import { renderEditorSection } from "../editor/section.js";

export const confirmationReminderStyles = css`
  .nc-reminder-options {
    display: grid;
    gap: 12px;
    margin-bottom: 16px;
  }

`;

export function renderConfirmationReminderSection(
  context: EditorSectionContext<"hass" | "refreshStatuses">,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return renderEditorSection(
    context.localize("editor.confirmation.reminder.section"),
    html`<div class="nc-reminder-options">
        <label class="nc-switch-label">
          <ha-switch
            .checked=${confirmation.reminders.show_attempts === true}
            aria-label=${context.localize("editor.confirmation.reminder.show_attempt_count")}
            @change=${(event: Event) => {
              confirmation.reminders.show_attempts = checkedValue(event);
              context.markDirty();
            }}
          ></ha-switch>
          <span>${context.localize("editor.confirmation.reminder.show_attempt_count")}</span>
        </label>
      </div>
      <div class="nc-grid">
        ${renderFormField(
          context.localize("editor.confirmation.reminder.remind_every"),
          html`<ha-notifications-duration-input
            .hass=${context.hass}
            .value=${durationInputValue(confirmation.reminders.interval, "00:30:00")}
            aria-label=${context.localize("editor.confirmation.reminder.remind_every")}
            @nc-duration-change=${(event: CustomEvent<{ value: string }>) => {
              confirmation.reminders.interval = event.detail.value;
              context.markDirty();
            }}
          ></ha-notifications-duration-input>`,
        )}
        ${renderFormField(
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
                Math.max(1, Number(formValue(event)) || 5),
              );
              context.markDirty();
            }}
          ></ha-input>`,
        )}
      </div>`,
    "",
    context.activeSection === "Reminder policy",
    confirmationReminderStyles,
  );
}
