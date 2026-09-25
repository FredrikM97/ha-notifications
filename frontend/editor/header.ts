import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import type { Alert } from "../types.js";
import { localizeEditorTitle } from "../localize.js";
import {
  editorSectionControl,
  optionalControls,
} from "./helpers.js";
import type {
  EditorContext,
  OptionalSetting,
  OptionalSettings,
} from "./types.js";

export interface EditorHeaderOptions {
  alert: Alert;
  context: EditorContext;
  optionalSettings: OptionalSettings;
  activeSectionIndex: number;
  sectionTitle: string;
  mobileSectionsOpen: boolean;
  onToggleSetting(setting: OptionalSetting, enabled: boolean): void;
  onToggleMobileSections(): void;
  onSectionManageButton(element: HTMLElement): void;
  renderNavigation(className?: string): TemplateResult;
}

export function renderEditorHeader({
  alert,
  context,
  optionalSettings,
  activeSectionIndex,
  sectionTitle,
  mobileSectionsOpen,
  onToggleSetting,
  onToggleMobileSections,
  onSectionManageButton,
  renderNavigation,
}: EditorHeaderOptions): TemplateResult {
  return html`<header class="nc-editor-header">
    <div class="nc-editor-identity">
      <div class="nc-editor-title-row">
        <h1 data-role="editor-alert-name">${alert.name.trim() || context.localize("editor.common.new_alert")}</h1>
        <span class="nc-editor-title-separator" aria-hidden="true">/</span>
        <h2 data-role="editor-section-title">${localizeEditorTitle(context.localize, sectionTitle)}</h2>
      </div>
    </div>
    <div class="nc-editor-section-controls">
      ${editorSectionControl(
        "postSendActions",
        optionalControls(
          context,
          Boolean(alert.post_send_actions?.enabled),
          context.localize("editor.notification.post_send_actions"),
          (enabled) => onToggleSetting("postSendActions", enabled),
        ),
        activeSectionIndex === 5,
      )}
      ${editorSectionControl(
        "confirmation",
        optionalControls(
          context,
          Boolean(alert.confirmation?.enabled),
          context.localize("editor.confirmation.toggle"),
          (enabled) => onToggleSetting("confirmation", enabled),
        ),
        activeSectionIndex === 6,
      )}
      ${editorSectionControl(
        "confirmationReminder",
        optionalControls(
          context,
          alert.confirmation?.reminders.enabled !== false,
          context.localize("editor.confirmation.reminder.section"),
          (enabled) => onToggleSetting("confirmationReminder", enabled),
        ),
        activeSectionIndex === 7,
      )}
      ${editorSectionControl(
        "confirmationNotification",
        optionalControls(
          context,
          alert.confirmation?.notification.enabled === true,
          context.localize("editor.confirmation.notification.section"),
          (enabled) => onToggleSetting("confirmationNotification", enabled),
        ),
        activeSectionIndex === 8,
      )}
      ${editorSectionControl(
        "postConfirmationActions",
        optionalControls(
          context,
          Boolean(alert.confirmation?.actions.enabled),
          context.localize("editor.confirmation.actions.section"),
          (enabled) => onToggleSetting("postConfirmationActions", enabled),
        ),
        activeSectionIndex === 9,
      )}
    </div>
    <button
      ${ref((element) => {
        if (element) onSectionManageButton(element as HTMLElement);
      })}
      class="nc-button secondary nc-section-manage-button"
      data-role="section-manage"
      type="button"
      aria-expanded=${String(mobileSectionsOpen)}
        aria-label=${mobileSectionsOpen ? context.localize("editor.common.close_sections") : context.localize("editor.common.manage_sections")}
      title=${mobileSectionsOpen ? context.localize("editor.common.close_sections") : context.localize("editor.common.manage_sections")}
      @click=${onToggleMobileSections}
    >
      <ha-icon icon="mdi:menu"></ha-icon>
    </button>
    ${renderNavigation("nc-section-header nc-mobile-section-menu")}
  </header>`;
}