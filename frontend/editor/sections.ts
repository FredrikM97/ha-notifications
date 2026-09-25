import { html } from "lit";
import type { TemplateResult } from "lit";
import { renderBasicSection } from "../sections/basic.js";
import { renderConditionSection } from "../sections/condition.js";
import { renderConfirmationSection } from "../sections/confirmation.js";
import { renderConfirmationNotificationSection } from "../sections/confirmation-notification.js";
import { renderConfirmationReminderSection } from "../sections/confirmation-reminder.js";
import { renderMonitorSection } from "../sections/monitor.js";
import { renderNotificationSection } from "../sections/notification.js";
import { renderPostConfirmationActionsSection } from "../sections/post-confirmation-actions.js";
import { renderPostSendActionsSection } from "../sections/post-send-actions.js";
import { renderRecipientSection } from "../sections/recipients.js";
import type { EditorContext, OptionalSettings } from "./types.js";

export function renderEditorSections(
  context: EditorContext,
  optionalSettings: OptionalSettings,
): TemplateResult {
  return html`${renderBasicSection(context)}${renderMonitorSection(
    context,
  )}${renderConditionSection(context)}${renderRecipientSection(
    context,
  )}${renderNotificationSection(context)}
    <div
      class="nc-optional-setting"
      data-setting="postSendActions"
      ?hidden=${!optionalSettings.postSendActions}
    >
      ${renderPostSendActionsSection(context)}
    </div>
    <div
      class="nc-optional-setting"
      data-setting="confirmation"
      ?hidden=${!optionalSettings.confirmation}
    >
      ${renderConfirmationSection(context)}
    </div>
    <div
      class="nc-optional-setting"
      data-setting="confirmationReminder"
      ?hidden=${!optionalSettings.confirmationReminder ||
      !optionalSettings.confirmation}
    >
      ${renderConfirmationReminderSection(context)}
    </div>
    <div
      class="nc-optional-setting"
      data-setting="confirmationNotification"
      ?hidden=${!optionalSettings.confirmationNotification ||
      !optionalSettings.confirmation}
    >
      ${renderConfirmationNotificationSection(context)}
    </div>
    <div
      class="nc-optional-setting"
      data-setting="postConfirmationActions"
      ?hidden=${!optionalSettings.postConfirmationActions}
    >
      ${renderPostConfirmationActionsSection(context)}
    </div>`;
}