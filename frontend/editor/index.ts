import { errorMessage } from "../api.js";
import { buildAlertPayload, type AlertFormValues } from "../alert-payload.js";
import { visualConditionBuilder } from "../condition-builder.js";
import { createRecipientPicker } from "../recipient-picker.js";
import { html, nothing, render } from "lit";
import type { TemplateResult } from "lit";
import * as YAML from "yaml";
import { ref } from "lit/directives/ref.js";
import type { Alert, Hass, Registries } from "../types.js";
import {
  clone,
  editorSections,
  type CodeEditor,
  type EditorContext,
  type EditorMode,
  type OptionalSetting,
  type OptionalSettings,
  type SectionStatus,
} from "./types.js";
import {
  actionArrayValue,
  checkedOf,
  constrainCodeEditor,
  conditionTemplate,
  conditionsYaml,
  defaultAlert,
  durationInputValue,
  editorSectionControl,
  editorModeFor,
  enabledLabel,
  fillActionEditors,
  isSectionVisible,
  optionalControls,
  parseConditionsYaml,
  showEditorToast,
  showYaml,
  valueOf,
} from "./helpers.js";
import { toastListTemplate, type Toast } from "../toast.js";
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

interface OpenEditorOptions {
  root: ShadowRoot;
  hass: Hass;
  alert?: Alert;
  registries: Registries;
  onSave: (alert: Alert) => Promise<Alert | void>;
  onSaved?: (alert: Alert) => Promise<void> | void;
  onClosed?: () => void;
  onTest: (alert: Alert) => Promise<unknown>;
  onValidateCondition: (alert: Alert) => Promise<unknown>;
}

// The dialog's DOM, dirty-tracking, and section wiring are all tightly
// coupled, so this is a class rather than a bag of closures: every piece of
// state is one `this.` away instead of hidden in a captured variable, which
// makes it possible to extract pieces (e.g. the nav sidebar) into their own
// controller later without re-threading a dozen closure variables.
class AlertEditorController {
  private readonly root: ShadowRoot;
  private readonly registries: Registries;
  private readonly onSave: (alert: Alert) => Promise<Alert | void>;
  private readonly onSaved?: (alert: Alert) => Promise<void> | void;
  private readonly onClosed?: () => void;
  private readonly onTest: (alert: Alert) => Promise<unknown>;
  private readonly onValidateCondition: (alert: Alert) => Promise<unknown>;

  private readonly value: Alert;
  private readonly host: HTMLElement = document.createElement("div");
  private readonly context: EditorContext;
  private readonly optionalSettings: OptionalSettings;
  private readonly collapsedParents = new Set<string>();

  private dirty = false;
  private discardDialogOpen = false;
  private activeSectionIndex = 0;
  private mobileSectionsOpen = false;
  private toasts: Toast[] = [];
  private modal: {
    title: string;
    content: TemplateResult;
    modalClass: string;
    closeLabel: string;
    yaml?: Alert;
  } | null = null;
  private yamlModalEditor?: CodeEditor;
  private conditionsYamlEditor?: CodeEditor;
  private actionsEditor?: CodeEditor;
  private notificationActionsEditor?: CodeEditor;
  private mobileMenu?: HTMLElement;
  private sectionManageButton?: HTMLElement;
  private handleOutsideSectionPointer = (event: PointerEvent): void => {
    if (!this.mobileSectionsOpen) return;

    const path = event.composedPath();
    if (this.mobileMenu && path.includes(this.mobileMenu)) return;
    if (this.sectionManageButton && path.includes(this.sectionManageButton)) return;
    this.closeMobileSections();
  };

  private visual!: HTMLElement;
  private conditionsYamlView!: HTMLElement;
  private jinja!: HTMLElement;
  private recipientMount!: HTMLElement;
  private visualConditions!: () => Alert["conditions"];
  private recipients!: ReturnType<typeof createRecipientPicker>;

  constructor(options: OpenEditorOptions) {
    this.root = options.root;
    this.registries = options.registries;
    this.onSave = options.onSave;
    this.onSaved = options.onSaved;
    this.onClosed = options.onClosed;
    this.onTest = options.onTest;
    this.onValidateCondition = options.onValidateCondition;

    this.value = clone(options.alert || defaultAlert());
    this.value.confirmation = {
      enabled: false,
      buttons: [{ id: "confirm", label: "Done" }],
      notification: { enabled: false, message: "", clear: true },
      reminders: {
        enabled: true,
        interval: "00:30:00",
        max_attempts: 5,
        show_attempts: false,
      },
      actions: { enabled: false, items: [] },
      ...this.value.confirmation,
    };

    this.root.addEventListener("nc-editor-toast", this.handleToastEvent);
    this.root.addEventListener("nc-editor-modal", this.handleModalEvent);

    this.context = {
      hass: options.hass,
      value: this.value,
      mode: editorModeFor(this.value),
      activeSection: editorSections[0].title,
      setEditorElement: (role, element) => {
        if (role === "visual") this.visual = element;
        if (role === "conditions-yaml") this.conditionsYamlView = element;
        if (role === "jinja") this.jinja = element;
        if (role === "recipients") this.recipientMount = element;
      },
      setEditorControl: (role, element) => {
        if (role === "conditions-yaml") this.conditionsYamlEditor = element;
        if (role === "actions") this.actionsEditor = element;
        if (role === "notification-actions") {
          this.notificationActionsEditor = element;
        }
      },
      markDirty: this.markDirty,
      refreshStatuses: this.refreshStatuses,
      setMode: this.setMode,
      validateCondition: this.validateCondition,
      validateActions: this.validateActions,
    };
    this.optionalSettings = {
      confirmation: true,
      confirmationReminder: true,
      confirmationNotification: true,
      postSendActions: true,
      postConfirmationActions: true,
    };

    this.renderEditor();
    this.root.append(this.host);
    document.addEventListener("pointerdown", this.handleOutsideSectionPointer);
    void fillActionEditors(this.host);

    this.visualConditions = visualConditionBuilder(
      this.visual,
      this.context.hass,
      this.registries,
      this.value.conditions,
      this.context.markDirty,
    );
    this.recipients = createRecipientPicker(
      this.registries,
      this.value.notification.target,
      this.context.markDirty,
    );
    render(html`${this.recipients.element}`, this.recipientMount);

    this.showSection(0);
  }

  private handleToastEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{ message: string; duration: number }>).detail;
    const toast: Toast = { id: Date.now(), message: detail.message, error: false };
    this.toasts = [...this.toasts, toast];
    this.renderEditor();
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((item) => item.id !== toast.id);
      this.renderEditor();
    }, detail.duration);
  };

  private handleModalEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{
      kind: "yaml" | "template-help";
      alert?: Alert;
      title?: string;
      content?: TemplateResult;
      modalClass?: string;
      closeLabel?: string;
    }>).detail;
    if (detail.kind === "yaml" && detail.alert) {
      this.modal = {
        title: "Alert YAML",
        content: html`<ha-code-editor
          class="nc-code-editor nc-alert-yaml-editor"
          mode="yaml"
          language="yaml"
          aria-label="Alert YAML"
          .value=${""}
          ${ref((element) => {
            if (element) this.yamlModalEditor = element as CodeEditor;
          })}
        ></ha-code-editor>`,
        modalClass: "nc-alert-yaml-modal",
        closeLabel: "Close YAML",
        yaml: detail.alert,
      };
    } else if (detail.title && detail.content) {
      this.modal = {
        title: detail.title,
        content: detail.content,
        modalClass: detail.modalClass || "",
        closeLabel: detail.closeLabel || "Close",
      };
    }
    this.renderEditor();
    if (this.modal?.yaml) void this.prepareYamlModal(this.modal.yaml);
  };

  private async prepareYamlModal(alert: Alert): Promise<void> {
    await customElements.whenDefined("ha-code-editor");
    await this.yamlModalEditor?.updateComplete;
    if (!this.yamlModalEditor) return;
    constrainCodeEditor(this.yamlModalEditor);
    this.yamlModalEditor.value = YAML.stringify(alert);
  }

  private closeModal = (): void => {
    this.modal = null;
    this.yamlModalEditor = undefined;
    this.renderEditor();
  };

  private modalTemplate(): TemplateResult | typeof nothing {
    if (!this.modal) return nothing;
    return html`<div
      class="nc-modal-backdrop"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget) this.closeModal();
      }}
    >
      <section class=${`nc-modal ${this.modal.modalClass}`} role="dialog" aria-modal="true">
        <header class="nc-modal-header">
          <h2>${this.modal.title}</h2>
          <button class="nc-icon-button" @click=${this.closeModal} aria-label=${this.modal.closeLabel} title=${this.modal.closeLabel}>
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </header>
        <main class="nc-modal-body">${this.modal.content}</main>
      </section>
    </div>`;
  }

  private renderEditor = (): void => {
    const optionalSettings = this.optionalSettings;
    const context = this.context;
    render(
      html`<div class="nc-editor-view">
        <section class="nc-editor-shell">
          <header class="nc-editor-header">
            <div class="nc-editor-identity">
              <div class="nc-editor-title-row">
                <h1 data-role="editor-alert-name">${this.value.name.trim() || "New alert"}</h1>
                <span class="nc-editor-title-separator" aria-hidden="true"
                  >/</span
                >
                <h2 data-role="editor-section-title">${this.sectionLabel(
                  editorSections[this.activeSectionIndex]?.parent,
                  editorSections[this.activeSectionIndex]?.title || "",
                )}</h2>
              </div>
            </div>
            <div class="nc-editor-section-controls">
              ${editorSectionControl(
                "postSendActions",
                optionalControls(
                  context,
                  Boolean(this.value.post_send_actions?.enabled),
                  "post-send actions",
                  (enabled) => {
                    this.value.post_send_actions = {
                      enabled,
                      actions: this.value.post_send_actions?.actions,
                    };
                    this.markDirty();
                  },
                ),
                this.activeSectionIndex === 5,
              )}
              ${editorSectionControl(
                "confirmation",
                optionalControls(
                  context,
                  Boolean(this.value.confirmation?.enabled),
                  "confirmation",
                  (enabled) => {
                    this.value.confirmation!.enabled = enabled;
                    this.markDirty();
                  },
                ),
                this.activeSectionIndex === 6,
              )}
              ${editorSectionControl(
                "confirmationReminder",
                optionalControls(
                  context,
                  this.value.confirmation?.reminders.enabled !== false,
                  "reminder policy",
                  (enabled) => {
                    this.value.confirmation!.reminders.enabled = enabled;
                    this.markDirty();
                  },
                ),
                this.activeSectionIndex === 7,
              )}
              ${editorSectionControl(
                "confirmationNotification",
                optionalControls(
                  context,
                  this.value.confirmation?.notification.enabled === true,
                  "confirmation notification",
                  (enabled) => {
                    this.value.confirmation!.notification.enabled = enabled;
                    this.markDirty();
                  },
                ),
                this.activeSectionIndex === 8,
              )}
              ${editorSectionControl(
                "postConfirmationActions",
                optionalControls(
                  context,
                  Boolean(this.value.confirmation?.actions.enabled),
                  "post-confirmation actions",
                  (enabled) => {
                    this.value.confirmation!.actions.enabled = enabled;
                    this.markDirty();
                  },
                ),
                this.activeSectionIndex === 9,
              )}
            </div>
            <button ${ref((element) => {
              if (element) this.sectionManageButton = element as HTMLElement;
            })}
              class="nc-button secondary nc-section-manage-button"
              data-role="section-manage"
              type="button"
              aria-expanded=${String(this.mobileSectionsOpen)}
              aria-label=${this.mobileSectionsOpen ? "Close section menu" : "Manage sections"}
              title=${this.mobileSectionsOpen ? "Close section menu" : "Manage sections"}
              @click=${this.toggleMobileSections}
            >
              <ha-icon icon="mdi:menu"></ha-icon>
            </button>
            ${this.renderSectionNavigation(
              "nc-section-header nc-mobile-section-menu",
            )}
          </header>
          <main class="nc-modal-body">
            <div class="nc-editor-layout">
              ${this.renderSectionNavigation()}
              <div class="nc-editor-sections">
                ${renderBasicSection(context)}${renderMonitorSection(
                  context,
                )}${renderConditionSection(
                  context,
                )}${renderRecipientSection(context)}${renderNotificationSection(
                  context,
                )}
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
                </div>
              </div>
            </div>
          </main>
          <footer class="nc-modal-footer">
            <span class="nc-editor-state" aria-live="polite"
              >${this.dirty ? "Unsaved changes" : "All changes saved"}</span
            >
            <button
              class="nc-icon-button"
              type="button"
              aria-label="View alert YAML"
              title="View alert YAML"
              aria-expanded="false"
              @click=${this.yamlView}
            >
              <ha-icon icon="mdi:code-braces"></ha-icon>
            </button>
            <button class="nc-button secondary" @click=${() => this.close()}>
              Cancel</button
            ><button
              class="nc-button secondary"
              data-role="editor-validate"
              @click=${this.validateCurrentSection}
              ?hidden=${!this.validationLabel()}
              aria-label=${this.validationLabel() || nothing}
            >${this.validationLabel()}</button
            ><button class="nc-button secondary" @click=${this.test}>
              Test alert</button
            ><button class="nc-button" @click=${this.save}>Save alert</button>
          </footer>
        </section>
        ${this.discardDialog()}${this.modalTemplate()}${toastListTemplate(
          this.toasts,
        )}
      </div>`,
      this.host,
    );
  };

  private markDirty = (): void => {
    this.dirty = true;
    this.renderEditor();
  };

  private setMode = (mode: EditorMode): void => {
    if (mode === "yaml" && this.context.mode === "visual") {
      if (this.conditionsYamlEditor) {
        this.conditionsYamlEditor.value = conditionsYaml(this.visualConditions());
      }
    }

    this.context.mode = mode;
    this.markDirty();
  };

  private refreshStatuses = (): void => {
    this.renderEditor();
  };

  private renderSectionNavigation = (className = "nc-section-header") =>
    html`<nav
      ${className.includes("mobile")
        ? ref((element) => {
            if (element) this.mobileMenu = element as HTMLElement;
          })
        : nothing}
      class=${`${className}${
        this.mobileSectionsOpen ? " mobile-open" : ""
      }`}
      aria-label="Alert sections"
    >
      ${editorSections.map(({ title, setting, parent, status }, index) => {
        const hasChildren = editorSections.some(
          (section) => section.parent === title,
        );
        return html`<div
          class="nc-section-nav-row"
          data-setting=${setting || nothing}
          data-parent=${parent || nothing}
          ?hidden=${!isSectionVisible(setting, this.optionalSettings) ||
          (parent === "Confirmation" && !this.optionalSettings.confirmation)}
        >
          <button
            class=${this.sectionNavButtonClass(setting, parent, index)}
            aria-current=${index === this.activeSectionIndex ? "step" : nothing}
            @click=${() => this.showSection(index)}
          >
            ${this.sectionStatus(status)}
            <span>${title}</span>
          </button>
          ${this.sectionCollapseButton(hasChildren, title)}
        </div>`;
      })}
    </nav>`;

  private showSection = (index: number): void => {
    this.activeSectionIndex = index;
    this.context.activeSection = editorSections[index]?.title || "Basic";
    this.closeMobileSections();
    this.renderEditor();
  };
  private validationLabel = (): string => {
    const sectionTitle = editorSections[this.activeSectionIndex]?.title;
    if (sectionTitle === "Condition") {
      return "Validate condition";
    }

    if (
      sectionTitle === "Post-send actions" ||
      sectionTitle === "Post-confirmation actions"
    ) {
      return "Validate actions";
    }
    return "";
  };

  private toggleSidebarChildren = (parent: string): void => {
    const collapsed = !this.collapsedParents.has(parent);
    if (collapsed) this.collapsedParents.add(parent);
    else this.collapsedParents.delete(parent);

    this.renderEditor();
  };

  private toggleMobileSections = (): void => {
    this.setMobileSectionsOpen(!this.mobileSectionsOpen);
  };

  private closeMobileSections = (): void => {
    this.setMobileSectionsOpen(false);
  };

  private setMobileSectionsOpen = (open: boolean): void => {
    if (this.mobileSectionsOpen === open) return;

    this.mobileSectionsOpen = open;
    this.renderEditor();
  };

  private sectionStatus(status: SectionStatus | undefined) {
    if (!status) {
      return nothing;
    }

    const enabled = this.sectionStatusEnabled(status);
    return html`<span
      class=${`nc-section-status${enabled ? " active" : ""}`}
      data-status=${status}
      aria-label=${enabledLabel(enabled)}
      >${this.sectionStatusSymbol(enabled)}</span
    >`;
  }

  private sectionStatusEnabled(status: SectionStatus): boolean {
    if (status === "postSendActions") {
      return Boolean(this.value.post_send_actions?.enabled);
    }
    if (status === "confirmation") {
      return Boolean(this.value.confirmation?.enabled);
    }
    if (status === "postConfirmationActions") {
      return Boolean(
        this.value.confirmation?.enabled &&
          this.value.confirmation.actions.enabled,
      );
    }
    if (status === "confirmationReminder") {
      return Boolean(
        this.value.confirmation?.enabled &&
          this.value.confirmation.reminders.enabled,
      );
    }
    return Boolean(
      this.value.confirmation?.enabled &&
        this.value.confirmation.notification.enabled,
    );
  }

  private sectionNavButtonClass(
    setting: OptionalSetting | undefined,
    parent: string | undefined,
    index: number,
  ): string {
    const classes = ["nc-section-nav-button"];
    if (setting) {
      classes.push("nc-optional-setting");
    }
    if (parent) {
      classes.push("nc-section-nav-child");
    }
    if (index === this.activeSectionIndex) {
      classes.push("active");
    }

    return classes.join(" ");
  }

  private sectionCollapseButton(hasChildren: boolean, title: string) {
    if (!hasChildren) {
      return nothing;
    }

    const collapsed = this.collapsedParents.has(title);
    return html`<button
      class="nc-section-collapse-button"
      type="button"
      aria-label=${this.sidebarToggleLabel(collapsed, title)}
      title=${this.sidebarToggleLabel(collapsed, title)}
      aria-expanded=${String(!collapsed)}
      data-collapse-parent=${title}
      @click=${() => this.toggleSidebarChildren(title)}
    >
      <ha-icon icon=${this.sidebarToggleIcon(collapsed)}></ha-icon>
    </button>`;
  }

  private sectionLabel(parent: string | undefined, title: string): string {
    if (parent) {
      return `${parent} / ${title}`;
    }

    return title;
  }

  private sectionStatusSymbol(isEnabled: boolean): string {
    if (isEnabled) {
      return "✓";
    }

    return "×";
  }

  private sidebarToggleLabel(collapsed: boolean, parent: string): string {
    let action = "Collapse";
    if (collapsed) {
      action = "Expand";
    }

    return `${action} ${parent} subpanels`;
  }

  private sidebarToggleIcon(collapsed: boolean): string {
    if (collapsed) {
      return "mdi:chevron-right";
    }

    return "mdi:chevron-down";
  }

  private showDiscardDialog = (): void => {
    if (this.discardDialogOpen) return;
    this.discardDialogOpen = true;
    this.renderEditor();
  };

  private discardDialog = (): TemplateResult | typeof nothing => {
    if (!this.discardDialogOpen) return nothing;
    const closeDialog = (): void => {
      this.discardDialogOpen = false;
      this.renderEditor();
    };
    const discard = (): void => {
      this.discardDialogOpen = false;
      this.close({ force: true });
    };
    return html`<div
        class="nc-modal-backdrop"
        role="presentation"
        @click=${(event: MouseEvent) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <section
          class="nc-modal nc-discard-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nc-discard-title"
        >
          <header class="nc-modal-header">
            <h2 id="nc-discard-title">Unsaved changes</h2>
          </header>
          <main class="nc-modal-body">
            <p>You have unsaved changes. Leave without saving?</p>
          </main>
          <footer class="nc-modal-footer">
            <button class="nc-button secondary" @click=${closeDialog}>
              Stay
            </button>
            <button class="nc-button" @click=${discard}>
              Discard changes
            </button>
          </footer>
        </section>
      </div>`;
  };

  private close = ({ force = false }: { force?: boolean } = {}): boolean => {
    if (!force && this.dirty) {
      this.showDiscardDialog();
      return false;
    }
    this.discardDialogOpen = false;
    document.removeEventListener("pointerdown", this.handleOutsideSectionPointer);
    this.host.remove();
    this.onClosed?.();
    this.root.removeEventListener("nc-editor-toast", this.handleToastEvent);
    this.root.removeEventListener("nc-editor-modal", this.handleModalEvent);
    return true;
  };

  private formPayload = (validate = true): Alert => {
    const value = this.value;
    const conditions = this.conditionsForCurrentMode();
    let confirmationActions: Record<string, unknown>[] = [];
    if (this.optionalSettings.postConfirmationActions) {
      confirmationActions = actionArrayValue(
        this.actionsEditor || null,
        "Post-confirmation actions",
      );
    }
    let notificationActions: Record<string, unknown>[] = [];
    if (this.optionalSettings.postSendActions) {
      notificationActions = actionArrayValue(
        this.notificationActionsEditor || null,
        "Post-send actions",
      );
    }
    const confirmation = value.confirmation!;
    const postSendActionsEnabled = Boolean(value.post_send_actions?.enabled);
    const postConfirmationActionsEnabled = Boolean(confirmation.actions.enabled);
    const payload: AlertFormValues = {
      identity: {
        name: value.name,
        description: value.description,
        icon: value.icon || "mdi:bell-outline",
      },
      monitor: {
        conditions,
        onChange: value.monitor.on_change,
        startup: value.monitor.startup,
        interval: this.monitorIntervalPayload(),
        clearOnInactive: value.monitor.clear_on_inactive === true,
      },
      notification: {
        target: this.recipients.target(),
        title: value.notification.title,
        message: value.notification.message,
      },
      confirmation: {
        enabled: Boolean(confirmation.enabled),
        buttons: confirmation.buttons,
        notification: {
          enabled: Boolean(confirmation.notification.enabled),
          message: confirmation.notification.message,
          clear: confirmation.notification.clear !== false,
        },
        reminders: {
          enabled: confirmation.reminders.enabled,
          interval: durationInputValue(
            confirmation.reminders.interval,
            "00:30:00",
          ),
          max_attempts: confirmation.reminders.max_attempts,
          show_attempts: confirmation.reminders.show_attempts === true,
          timeout: durationInputValue(
            confirmation.reminders.timeout,
            "00:15:00",
          ),
        },
        actions: {
          enabled: Boolean(confirmation.actions.enabled),
        },
      },
      post_send_actions: {
        postSendActionsEnabled: Boolean(value.post_send_actions?.enabled),
      },
    };
    if (notificationActions.length || postSendActionsEnabled) {
      payload.post_send_actions.actions = notificationActions;
    }
    if (confirmationActions.length || postConfirmationActionsEnabled) {
      payload.confirmation.actions.items = confirmationActions;
    }

    return buildAlertPayload(value, payload, validate);
  };

  private yamlView = (): void => {
    try {
      showYaml(this.root, this.formPayload(false));
    } catch (error) {
      showEditorToast(this.root, errorMessage(error));
    }
  };

  private conditionPayload = (): Alert => {
    const value = this.value;
    return {
      ...value,
      conditions: this.conditionsForCurrentMode(),
    };
  };

  private conditionsForCurrentMode(): Alert["conditions"] {
    if (this.context.mode === "visual") {
      return this.visualConditions();
    }

    if (this.context.mode === "yaml") {
      return parseConditionsYaml(this.conditionsYamlValue());
    }

    return [
      { type: "template" as const, template: conditionTemplate(this.value) },
    ];
  }

  private conditionsYamlValue(): string {
    return (
      this.conditionsYamlEditor?.value || "[]"
    );
  }

  private monitorIntervalPayload(): string | undefined {
    if (!this.value.monitor.interval) {
      return undefined;
    }

    return durationInputValue(this.value.monitor.interval, "12:00:00");
  }

  private hasRequiredCondition = (): boolean => {
    if (this.context.mode === "visual") {
      return this.visualConditions().length > 0;
    }

    if (this.context.mode === "yaml") {
      try {
        return (
          parseConditionsYaml(
            this.conditionsYamlEditor?.value || "[]",
          ).length > 0
        );
      } catch {
        return true;
      }
    }

    return Boolean(conditionTemplate(this.value).trim());
  };

  private validateCondition = async (): Promise<void> => {
    try {
      if (!this.hasRequiredCondition())
        throw new Error("Condition is required.");
      await this.onValidateCondition(this.conditionPayload());
    } catch (error) {
      showEditorToast(this.root, errorMessage(error));
    }
  };

  private validateCurrentSection = async (): Promise<void> => {
    const sectionTitle = editorSections[this.activeSectionIndex]?.title;
    if (sectionTitle === "Condition") {
      await this.validateCondition();
      return;
    }

    if (sectionTitle === "Post-send actions") {
      this.validateActions("notification-actions", "Post-send actions");
      return;
    }

    if (sectionTitle === "Post-confirmation actions") {
      this.validateActions("actions", "Post-confirmation actions");
    }
  };

  private validateActions = (role: string, label: string): void => {
    try {
      actionArrayValue(
        role === "actions"
          ? this.actionsEditor || null
          : this.notificationActionsEditor || null,
        label,
      );
      showEditorToast(this.root, `${label} are valid.`, 4000);
    } catch (error) {
      showEditorToast(this.root, errorMessage(error));
    }
  };

  private test = async (event: Event): Promise<void> => {
    const button = event.currentTarget as HTMLButtonElement;
    try {
      button.disabled = true;
      const result = await this.onTest(this.formPayload());
    } catch (error) {
      showEditorToast(this.root, errorMessage(error));
    } finally {
      button.disabled = false;
    }
  };

  private save = async (event: Event): Promise<void> => {
    const button = event.currentTarget as HTMLButtonElement;
    try {
      if (!this.value.name.trim()) throw new Error("Name is required.");
      if (!this.hasRequiredCondition())
        throw new Error("Condition is required.");
      if (!this.value.monitor.on_change && !this.value.monitor.interval)
        throw new Error("Enable condition changes, an interval, or both.");
      const result = this.formPayload();
      button.disabled = true;
      const saved = await this.onSave(result);
      const savedAlert = saved || result;
      Object.assign(this.value, savedAlert);
      this.dirty = false;
      this.close({ force: true });
      await this.onSaved?.(savedAlert);
    } catch (error) {
      showEditorToast(this.root, errorMessage(error));
    } finally {
      button.disabled = false;
    }
  };
}

export function openEditor(options: OpenEditorOptions): void {
  // Guard against a second click opening a stacked editor instance.
  if (options.root.querySelector(".nc-editor-view")) return;
  new AlertEditorController(options);
}
