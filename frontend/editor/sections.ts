import { html } from "lit";
import type { TemplateResult } from "lit";
import { renderBasicSection } from "../sections/basic.js";
import { renderConditionSection } from "../sections/condition.js";
import { renderConfirmationSection } from "../sections/confirmation.js";
import { renderConfirmationNotificationSection } from "../sections/confirmation-notification.js";
import { renderConfirmationReminderSection } from "../sections/confirmation-reminder.js";
import {
  renderCustomTriggersSection,
  renderTriggerSection,
} from "../sections/triggers.js";
import { renderNotificationSection } from "../sections/notification.js";
import { renderPostConfirmationActionsSection } from "../sections/post-confirmation-actions.js";
import { renderPostSendActionsSection } from "../sections/post-send-actions.js";
import { renderRecipientSection } from "../sections/recipients.js";
import type { EditorContext } from "./types.js";

export function renderEditorSections(context: EditorContext): TemplateResult {
  return html`${renderBasicSection(context)}${renderTriggerSection(
    context,
  )}${renderCustomTriggersSection(context)}${renderConditionSection(context)}${renderRecipientSection(
    context,
  )}${renderNotificationSection(context)}${renderPostSendActionsSection(
    context,
  )}${renderConfirmationSection(context)}${renderConfirmationReminderSection(
    context,
  )}${renderConfirmationNotificationSection(context)}${renderPostConfirmationActionsSection(
    context,
  )}`;
}