import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import type { Alert } from "../types.js";
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
        <h1 data-role="editor-alert-name">${alert.name.trim() || "New alert"}</h1>
        <span class="nc-editor-title-separator" aria-hidden="true">/</span>
        <h2 data-role="editor-section-title">${sectionTitle}</h2>
      </div>
    </div>
    <div class="nc-editor-section-controls">
      ${editorSectionControl(
        "postSendActions",
        optionalControls(
          context,
          Boolean(alert.post_send_actions?.enabled),
          "post-send actions",
          (enabled) => onToggleSetting("postSendActions", enabled),
        ),
        activeSectionIndex === 5,
      )}
      ${editorSectionControl(
        "confirmation",
        optionalControls(
          context,
          Boolean(alert.confirmation?.enabled),
          "confirmation",
          (enabled) => onToggleSetting("confirmation", enabled),
        ),
        activeSectionIndex === 6,
      )}
      ${editorSectionControl(
        "confirmationReminder",
        optionalControls(
          context,
          alert.confirmation?.reminders.enabled !== false,
          "reminder policy",
          (enabled) => onToggleSetting("confirmationReminder", enabled),
        ),
        activeSectionIndex === 7,
      )}
      ${editorSectionControl(
        "confirmationNotification",
        optionalControls(
          context,
          alert.confirmation?.notification.enabled === true,
          "confirmation notification",
          (enabled) => onToggleSetting("confirmationNotification", enabled),
        ),
        activeSectionIndex === 8,
      )}
      ${editorSectionControl(
        "postConfirmationActions",
        optionalControls(
          context,
          Boolean(alert.confirmation?.actions.enabled),
          "post-confirmation actions",
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
      aria-label=${mobileSectionsOpen ? "Close section menu" : "Manage sections"}
      title=${mobileSectionsOpen ? "Close section menu" : "Manage sections"}
      @click=${onToggleMobileSections}
    >
      <ha-icon icon="mdi:menu"></ha-icon>
    </button>
    ${renderNavigation("nc-section-header nc-mobile-section-menu")}
  </header>`;
}