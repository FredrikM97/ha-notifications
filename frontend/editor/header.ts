import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { Alert } from "../types.js";
import { localizeEditorTitle } from "../localize.js";
import { confirmationNotificationEnabled } from "./confirmation.js";
import { renderHelpTooltip } from "./section.js";
import { editorSections } from "./types.js";
import "../components/setting-toggle.js";
import type {
  EditorContext,
  OptionalSetting,
} from "./types.js";
import type { EditorNavigationController } from "./navigation.js";

export const editorHeaderStyles = css`
  .nc-editor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 20px 24px;
    border-bottom: 1px solid var(--divider-color);
  }

  .nc-editor-header h1,
  .nc-editor-header h2 {
    margin: 0;
  }

  .nc-editor-header h1 {
    font-size: 22px;
  }

  .nc-editor-identity {
    min-width: 0;
    flex: 1 1 auto;
  }

  .nc-editor-title-row {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    min-width: 0;
    gap: 10px;
  }

  .nc-editor-title-row h1,
  .nc-editor-title-row h2 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nc-editor-title-separator {
    color: var(--secondary-text-color);
    font-size: 18px;
  }

  .nc-editor-header h2 {
    color: var(--secondary-text-color);
    font-size: 18px;
    font-weight: 500;
  }

  .nc-section-manage-button {
    display: none;
  }

  @container (max-width: 900px) {
    .nc-editor-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: flex-start;
      gap: 6px;
      padding: 16px;
    }

    .nc-editor-identity {
      grid-column: 1;
      grid-row: 1;
    }

    .nc-section-manage-button {
      display: inline-grid;
      grid-column: 2;
      grid-row: 1;
      width: 40px;
      min-height: 40px;
      padding: 8px;
    }

    .nc-section-manage-button ha-icon {
      --mdc-icon-size: 20px;
    }

    .nc-editor-title-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 3px;
    }

    .nc-editor-title-separator {
      display: none;
    }

    .nc-editor-header h1 {
      font-size: 20px;
    }

    .nc-editor-header h2 {
      font-size: 14px;
    }
  }

  @media (max-width: 900px) {
    .nc-editor-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      position: relative;
      align-items: start;
      gap: 6px;
      padding: 16px;
      z-index: 100;
    }

    .nc-editor-identity {
      grid-column: 1;
      grid-row: 1;
    }

    .nc-section-manage-button {
      display: inline-grid;
      grid-column: 2;
      grid-row: 1;
      width: 40px;
      min-height: 40px;
      padding: 8px;
    }

    .nc-section-manage-button ha-icon {
      --mdc-icon-size: 20px;
    }
  }
`;

export interface EditorHeaderOptions {
  alert: Alert;
  context: EditorContext;
  postConfirmationActionsEnabled: boolean;
  activeSectionIndex: number;
  sectionTitle: string;
  navigation: EditorNavigationController;
  onToggleSetting(setting: OptionalSetting, enabled: boolean): void;
}

function optionalControls(
  context: EditorContext,
  setting: OptionalSetting,
  enabled: boolean,
  label: string,
  help: string | TemplateResult = "",
  disableText = context.localize("alert.disable"),
): TemplateResult {
  return html`<ha-notifications-setting-toggle
    .setting=${setting}
    .enabled=${enabled}
    .label=${label}
    .enableText=${context.localize("alert.enable")}
    .disableText=${disableText}
  >${help
      ? html`<span slot="help">${renderHelpTooltip(
          help,
          context.localize("editor.common.more_info"),
        )}</span>`
      : nothing}
  </ha-notifications-setting-toggle>`;
}

function editorSectionControl(
  setting: OptionalSetting,
  content: TemplateResult,
  visible: boolean,
): TemplateResult {
  return html`<div
    class="nc-editor-section-control"
    data-role="editor-section-control"
    data-setting=${setting}
    ?hidden=${!visible}
  >
    ${content}
  </div>`;
}

function isOptionalSetting(value: string): value is OptionalSetting {
  return [
    "postSendActions",
    "confirmation",
    "confirmationReminder",
    "confirmationNotification",
    "postConfirmationActions",
  ].includes(value);
}

export function renderEditorSectionControls({
  alert,
  context,
  postConfirmationActionsEnabled,
  activeSectionIndex,
  onToggleSetting,
}: EditorHeaderOptions): TemplateResult {
  const activeSetting = editorSections[activeSectionIndex]?.setting;
  return html`<div
    class="nc-editor-section-controls"
    ?hidden=${!activeSetting}
    @nc-setting-change=${(event: CustomEvent<{
      setting: string;
      enabled: boolean;
    }>) => {
      if (isOptionalSetting(event.detail.setting)) {
        onToggleSetting(event.detail.setting, event.detail.enabled);
      }
      }}
  >
    ${editorSectionControl(
      "postSendActions",
      optionalControls(
        context,
        "postSendActions",
        Boolean(alert.post_send_actions?.enabled),
        context.localize("editor.notification.post_send_actions"),
        context.localize("editor.notification.post_send_help"),
        context.localize("alert.enable"),
      ),
      activeSetting === "postSendActions",
    )}
    ${editorSectionControl(
      "confirmation",
      optionalControls(
        context,
        "confirmation",
        Boolean(alert.confirmation?.enabled),
        context.localize("editor.confirmation.toggle"),
        "",
        context.localize("alert.enable"),
      ),
      activeSetting === "confirmation",
    )}
    ${editorSectionControl(
      "confirmationReminder",
      optionalControls(
        context,
        "confirmationReminder",
        alert.confirmation?.reminders.enabled !== false,
        context.localize("editor.confirmation.reminder.section"),
      ),
      activeSetting === "confirmationReminder",
    )}
    ${editorSectionControl(
      "confirmationNotification",
      optionalControls(
        context,
        "confirmationNotification",
        alert.confirmation
          ? confirmationNotificationEnabled(alert.confirmation.notification)
          : false,
        context.localize("editor.confirmation.notification.section"),
        html`<p>${context.localize("editor.confirmation.notification.help")}</p>
          <p>${context.localize("editor.confirmation.notification.example")} <code>Confirmed by {{confirmed_by}}</code></p>
          <p>
            <code>confirmed_by</code>, <code>confirmation_response_id</code>,
            <code>confirmation_response</code>, <code>alert_id</code>,
            <code>alert_name</code>, <code>alert_active</code>,
            <code>trigger</code>, <code>attempt</code>, and <code>now</code> are
            available. Home Assistant helpers also work, for example
            <code>states('sensor.temperature')</code>,
            <code>state_attr('light.kitchen', 'brightness')</code>, and
            <code>is_state('binary_sensor.door', 'on')</code>.
          </p>`,
      ),
      activeSetting === "confirmationNotification",
    )}
    ${editorSectionControl(
      "postConfirmationActions",
      optionalControls(
        context,
        "postConfirmationActions",
        postConfirmationActionsEnabled,
        context.localize("editor.confirmation.actions.section"),
        context.localize("editor.confirmation.actions.help"),
      ),
      activeSetting === "postConfirmationActions",
    )}
  </div>`;
}

function renderHeader({
  alert,
  context,
  activeSectionIndex,
  sectionTitle,
  navigation,
}: EditorHeaderOptions): TemplateResult {
  return html`<header class="nc-editor-header">
    <div class="nc-editor-identity">
      <div class="nc-editor-title-row">
        <h1 data-role="editor-alert-name">${alert.name.trim() || context.localize("editor.common.new_alert")}</h1>
        <span class="nc-editor-title-separator" aria-hidden="true">/</span>
        <h2 data-role="editor-section-title">${localizeEditorTitle(context.localize, sectionTitle)}</h2>
      </div>
    </div>
    ${navigation.renderManageButton(context.localize)}
    ${navigation.render(
      context.localize,
      alert,
      activeSectionIndex,
      "nc-section-header nc-mobile-section-menu",
    )}
  </header>`;
}

const EDITOR_HEADER_TAG = "ha-notifications-editor-header";

class EditorHeaderComponent extends LitElement {
  static properties = {
    options: { attribute: false },
  };

  static styles = editorHeaderStyles;

  declare options: EditorHeaderOptions | null;

  constructor() {
    super();
    this.options = null;
  }

  protected render(): TemplateResult | typeof nothing {
    return this.options ? renderHeader(this.options) : nothing;
  }
}

if (!customElements.get(EDITOR_HEADER_TAG)) {
  customElements.define(EDITOR_HEADER_TAG, EditorHeaderComponent);
}

export function renderEditorHeader(options: EditorHeaderOptions): TemplateResult {
  return html`<ha-notifications-editor-header
    .options=${options}
  ></ha-notifications-editor-header>`;
}