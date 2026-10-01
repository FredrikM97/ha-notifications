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
    margin-top: 16px;
  }
`;

export function renderConfirmationReminderSection(
  context: EditorSectionContext<"hass">,
): TemplateResult {
  const confirmation = context.value.confirmation!;
  return renderEditorSection(
    context.localize("editor.confirmation.reminder.section"),
    html`<div class="nc-grid">
        ${renderFormField(
          context.localize("editor.confirmation.reminder.remind_every"),
          html`<ha-notifications-duration-input
            .hass=${context.hass}
            .value=${durationInputValue(confirmation.reminders.interval, "00:30:00")}
            .label=${context.localize("editor.confirmation.reminder.remind_every")}
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
        ${renderFormField(
          context.localize("editor.confirmation.reminder.forget_after"),
          html`<ha-notifications-duration-input
            .hass=${context.hass}
            .value=${durationInputValue(confirmation.reminders.timeout, "00:15:00")}
            .label=${context.localize("editor.confirmation.reminder.forget_after")}
            aria-label=${context.localize("editor.confirmation.reminder.forget_after")}
            @nc-duration-change=${(event: CustomEvent<{ value: string }>) => {
              confirmation.reminders.timeout = event.detail.value;
              context.markDirty();
            }}
          ></ha-notifications-duration-input>`,
        )}
      </div>
      <div class="nc-help">${context.localize("editor.confirmation.reminder.keep_until")}</div>
      <div class="nc-reminder-options">
        <label class="nc-switch-label">
          <ha-switch
            .checked=${confirmation.reminders.forget_after_enabled === true}
            @change=${(event: Event) => {
              confirmation.reminders.forget_after_enabled = checkedValue(event);
              context.markDirty();
            }}
          ></ha-switch>
          <span>${context.localize("editor.confirmation.reminder.enable_forget_after")}</span>
        </label>
        <label class="nc-switch-label">
          <ha-switch
            .checked=${confirmation.reminders.show_attempts === true}
            @change=${(event: Event) => {
              confirmation.reminders.show_attempts = checkedValue(event);
              context.markDirty();
            }}
          ></ha-switch>
          <span>${context.localize("editor.confirmation.reminder.show_attempt_count")}</span>
        </label>
      </div>
      </div>`,
    "",
    context.activeSection === "Reminder policy",
    confirmationReminderStyles,
  );
}
