import { errorMessage } from "../api.js";
import { buildAlertPayload, type AlertFormValues } from "../alert-payload.js";
import { visualConditionBuilder } from "../condition-builder.js";
import { createRecipientPicker } from "../recipient-picker.js";
import { html, nothing, render } from "lit";
import type { Alert, Registries } from "../types.js";
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
import {
  renderBasicSection,
  renderConditionSection,
  renderConfirmationSection,
  renderConfirmationNotificationSection,
  renderConfirmationReminderSection,
  renderMonitorSection,
  renderNotificationSection,
  renderPostConfirmationActionsSection,
  renderPostSendActionsSection,
  renderRecipientSection,
} from "../sections.js";

interface OpenEditorOptions {
  root: ShadowRoot;
  alert?: Alert;
  registries: Registries;
  onSave: (alert: Alert) => Promise<Alert | void>;
  onSaved?: (alert: Alert) => Promise<void> | void;
  onTest: (alert: Alert) => Promise<{ session_id: string }>;
  onValidateCondition: (alert: Alert) => Promise<unknown>;
  onDiscardTest: (sessionId: string) => Promise<unknown>;
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
  private readonly onTest: (alert: Alert) => Promise<{ session_id: string }>;
  private readonly onValidateCondition: (alert: Alert) => Promise<unknown>;
  private readonly onDiscardTest: (sessionId: string) => Promise<unknown>;

  private readonly value: Alert;
  private readonly host: HTMLElement = document.createElement("div");
  private readonly page: HTMLElement | null;
  private readonly dashboardContent: HTMLElement | null | undefined;
  private readonly dashboardTabs: HTMLElement | null | undefined;
  private readonly dashboardActions: HTMLElement | null | undefined;
  private readonly context: EditorContext;
  private readonly optionalSettings: OptionalSettings;
  private readonly collapsedParents = new Set<string>();

  private dirty = false;
  private draftTestSessionId: string | null = null;
  private activeSectionIndex = 0;

  private visual!: HTMLElement;
  private conditionsYamlView!: HTMLElement;
  private jinja!: HTMLElement;
  private visualConditions!: () => Alert["conditions"];
  private recipients!: ReturnType<typeof createRecipientPicker>;

  constructor(options: OpenEditorOptions) {
    this.root = options.root;
    this.registries = options.registries;
    this.onSave = options.onSave;
    this.onSaved = options.onSaved;
    this.onTest = options.onTest;
    this.onValidateCondition = options.onValidateCondition;
    this.onDiscardTest = options.onDiscardTest;

    this.value = clone(options.alert || defaultAlert());
    this.value.confirmation = {
      enabled: false,
      button: "",
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

    this.page = this.root.querySelector<HTMLElement>(".nc-page");
    this.dashboardContent = this.page?.querySelector<HTMLElement>(
      ".nc-alerts, .nc-empty, #history-view, #yaml-view",
    );
    this.dashboardTabs = this.page?.querySelector<HTMLElement>(".nc-tabs");
    this.dashboardActions =
      this.page?.querySelector<HTMLElement>(".nc-actions");
    if (this.dashboardContent) this.dashboardContent.hidden = true;
    if (this.dashboardTabs) this.dashboardTabs.hidden = true;
    if (this.dashboardActions) {
      const backButton = document.createElement("button");
      backButton.className = "nc-button secondary";
      backButton.textContent = "Back to alerts";
      backButton.addEventListener("click", () => this.close());
      this.dashboardActions.replaceChildren(backButton);
    }

    this.context = {
      value: this.value,
      mode: editorModeFor(this.value),
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
    void fillActionEditors(this.host);

    this.visual = this.host.querySelector<HTMLElement>('[data-role="visual"]')!;
    this.conditionsYamlView = this.host.querySelector<HTMLElement>(
      '[data-role="conditions-yaml"]',
    )!;
    const recipientMount = this.host.querySelector<HTMLElement>(
      '[data-role="recipients"]',
    )!;
    this.visualConditions = visualConditionBuilder(
      this.visual,
      this.registries,
      this.value.conditions,
      this.context.markDirty,
    );
    this.recipients = createRecipientPicker(
      this.registries,
      this.value.notification.target,
      this.context.markDirty,
    );
    recipientMount.replaceChildren(this.recipients.element);
    this.jinja = this.host.querySelector<HTMLElement>('[data-role="jinja"]')!;

    this.refreshEditorHeader();
    this.refreshStatuses();
    this.showSection(0);
  }

  private restoreDashboardAction = (): void => {
    if (!this.dashboardActions) return;

    const addButton = document.createElement("button");
    addButton.className = "nc-button";
    addButton.textContent = "+ Add alert";
    addButton.addEventListener("click", () => {
      const panel = this.root.host as HTMLElement & {
        addAlert?: () => Promise<void>;
      };
      void panel.addAlert?.();
    });
    this.dashboardActions.replaceChildren(addButton);
  };

  private renderEditor = (): void => {
    const optionalSettings = this.optionalSettings;
    const context = this.context;
    render(
      html`<div class="nc-editor-view">
        <section class="nc-editor-shell">
          <header class="nc-editor-header">
            <div class="nc-editor-identity">
              <div class="nc-editor-title-row">
                <h1 data-role="editor-alert-name">New alert</h1>
                <span class="nc-editor-title-separator" aria-hidden="true"
                  >/</span
                >
                <h2 data-role="editor-section-title">Basic</h2>
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
              )}
            </div>
          </header>
          <div
            class="nc-editor-validation"
            data-role="editor-validation"
            role="status"
            aria-live="polite"
            hidden
          ></div>
          <main class="nc-modal-body">
            <div class="nc-editor-layout">
              <nav class="nc-section-header" aria-label="Alert sections">
                ${editorSections.map(
                  ({ title, setting, parent, status }, index) => {
                    const hasChildren = editorSections.some(
                      (section) => section.parent === title,
                    );
                    return html` <div
                      class="nc-section-nav-row"
                      data-setting=${setting || nothing}
                      data-parent=${parent || nothing}
                      ?hidden=${!isSectionVisible(setting, optionalSettings) ||
                      (parent === "Confirmation" &&
                        !optionalSettings.confirmation)}
                    >
                      <button
                        class=${this.sectionNavButtonClass(setting, parent)}
                        @click=${() => this.showSection(index)}
                      >
                        ${this.sectionStatus(status)}
                        <span>${title}</span>
                      </button>
                      ${this.sectionCollapseButton(hasChildren, title)}
                    </div>`;
                  },
                )}
              </nav>
              <select
                class="nc-section-select"
                aria-label="Alert section"
                @change=${(event: Event) =>
                  this.showSection(Number(valueOf(event)))}
              >
                ${editorSections.map(
                  ({ title, setting, parent }, index) =>
                    html`<option
                      value=${index}
                      ?disabled=${!isSectionVisible(
                        setting,
                        optionalSettings,
                      ) ||
                      (parent === "Confirmation" &&
                        !optionalSettings.confirmation)}
                    >
                      ${this.sectionLabel(parent, title)}
                    </option>`,
                )}
              </select>
              <div class="nc-editor-sections">
                ${renderBasicSection(context)}${renderMonitorSection(
                  context,
                )}${renderConditionSection(
                  context,
                )}${renderRecipientSection()}${renderNotificationSection(
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
            <span class="nc-editor-state" aria-live="polite">All changes saved</span>
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
              hidden
            ></button
            ><button class="nc-button secondary" @click=${this.test}>
              Test alert</button
            ><button class="nc-button" @click=${this.save}>Save alert</button>
          </footer>
        </section>
      </div>`,
      this.host,
    );
  };

  private markDirty = (): void => {
    this.dirty = true;
    const state = this.host.querySelector<HTMLElement>(".nc-editor-state");
    if (state) state.textContent = "Unsaved changes";
    this.refreshEditorHeader();
    this.refreshSectionControls();
    this.refreshStatuses();
  };

  private refreshEditorHeader = (): void => {
    const name = this.host.querySelector<HTMLElement>(
      '[data-role="editor-alert-name"]',
    );
    if (name) name.textContent = this.value.name.trim() || "New alert";
  };

  private setMode = (mode: EditorMode): void => {
    if (mode === "yaml" && this.context.mode === "visual") {
      const editor = this.host.querySelector<CodeEditor>(
        '[data-role="conditions-yaml-editor"]',
      );
      if (editor) editor.value = conditionsYaml(this.visualConditions());
    }

    this.context.mode = mode;
    this.markDirty();
    this.refreshStatuses();
  };

  private refreshStatuses = (): void => {
    const value = this.value;
    this.visual.hidden = this.context.mode !== "visual";
    this.conditionsYamlView.hidden = this.context.mode !== "yaml";
    this.jinja.hidden = this.context.mode !== "jinja";
    const enabled: Record<SectionStatus, boolean> = {
      postSendActions: Boolean(value.post_send_actions?.enabled),
      confirmation: Boolean(value.confirmation?.enabled),
      postConfirmationActions: Boolean(
        value.confirmation?.enabled && value.confirmation.actions.enabled,
      ),
      confirmationReminder: Boolean(
        value.confirmation?.enabled &&
          value.confirmation.reminders.enabled,
      ),
      confirmationNotification: Boolean(
        value.confirmation?.enabled &&
          value.confirmation.notification.enabled,
      ),
    };
    this.host
      .querySelectorAll<HTMLElement>(".nc-section-status")
      .forEach((indicator) => {
        const status = indicator.dataset.status as SectionStatus | undefined;
        const isEnabled = Boolean(status && enabled[status]);
        indicator.classList.toggle("active", isEnabled);
        indicator.textContent = this.sectionStatusSymbol(isEnabled);
        indicator.setAttribute("aria-label", enabledLabel(isEnabled));
      });
    this.refreshValidationSummary();
  };

  private refreshValidationSummary = (): void => {
    const validation = this.host.querySelector<HTMLElement>(
      '[data-role="editor-validation"]',
    );
    if (!validation) return;

    const issues: string[] = [];
    if (!this.value.name.trim()) issues.push("Basic: name is required.");
    if (!this.hasRequiredCondition()) {
      issues.push("Condition: add at least one condition.");
    }
    const target = this.recipients?.target() || this.value.notification.target;
    const recipientCount = Object.values(target).reduce(
      (total, values) => total + (values?.length || 0),
    0);
    if (!recipientCount) issues.push("Recipients: add at least one recipient.");
    if (!this.value.monitor.on_change && !this.value.monitor.interval) {
      issues.push("When to check: enable changes, an interval, or both.");
    }
    validation.hidden = issues.length === 0;
    validation.textContent = issues.length
      ? `Needs attention: ${issues.join(" ")}`
      : "";
  };

  private showSection = (index: number): void => {
    this.activeSectionIndex = index;
    this.host
      .querySelectorAll<HTMLElement>(".nc-section")
      .forEach((item, itemIndex) =>
        item.classList.toggle("active", itemIndex === index),
      );
    this.host
      .querySelectorAll<HTMLButtonElement>(".nc-section-nav-button")
      .forEach((button, itemIndex) => {
        const active = itemIndex === index;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
    const select =
      this.host.querySelector<HTMLSelectElement>(".nc-section-select");
    if (select) select.value = String(index);
    const title = this.host.querySelector<HTMLElement>(
      '[data-role="editor-section-title"]',
    );
    if (title) {
      title.textContent = this.sectionLabel(
        editorSections[index]?.parent,
        editorSections[index]?.title || "",
      );
    }
    this.refreshValidationAction();
    this.refreshSectionControls();
  };

  private refreshSectionControls = (): void => {
    const setting = editorSections[this.activeSectionIndex]?.setting;
    this.host
      .querySelectorAll<HTMLElement>('[data-role="editor-section-control"]')
      .forEach((control) => {
        control.hidden = control.dataset.setting !== setting;
        const switchElement = control.querySelector<HTMLElement>("ha-switch");
        const state = control.querySelector<HTMLElement>(".nc-setting-state");
        if (!switchElement || !state) return;

        let enabled = false;
        if (control.dataset.setting === "postSendActions") {
          enabled = Boolean(this.value.post_send_actions?.enabled);
        } else if (control.dataset.setting === "confirmation") {
          enabled = Boolean(this.value.confirmation?.enabled);
        } else if (control.dataset.setting === "confirmationReminder") {
          enabled = this.value.confirmation?.reminders.enabled !== false;
        } else if (control.dataset.setting === "confirmationNotification") {
          enabled = this.value.confirmation?.notification.enabled === true;
        } else if (control.dataset.setting === "postConfirmationActions") {
          enabled = Boolean(this.value.confirmation?.actions.enabled);
        }

        (switchElement as HTMLElement & { checked?: boolean }).checked = enabled;
        state.textContent = enabledLabel(enabled);
      });
  };

  private refreshValidationAction = (): void => {
    const button = this.host.querySelector<HTMLButtonElement>(
      '[data-role="editor-validate"]',
    );
    if (!button) return;

    const sectionTitle = editorSections[this.activeSectionIndex]?.title;
    if (sectionTitle === "Condition") {
      button.hidden = false;
      button.textContent = "Validate condition";
      button.setAttribute("aria-label", "Validate condition");
      return;
    }

    if (
      sectionTitle === "Post-send actions" ||
      sectionTitle === "Post-confirmation actions"
    ) {
      button.hidden = false;
      button.textContent = "Validate actions";
      button.setAttribute("aria-label", "Validate actions");
      return;
    }

    button.hidden = true;
    button.textContent = "";
    button.removeAttribute("aria-label");
  };

  private toggleSidebarChildren = (parent: string): void => {
    const collapsed = !this.collapsedParents.has(parent);
    if (collapsed) this.collapsedParents.add(parent);
    else this.collapsedParents.delete(parent);

    this.host
      .querySelectorAll<HTMLElement>(
        `.nc-section-nav-row[data-parent="${parent}"]`,
      )
      .forEach((row) => {
        const setting = row.dataset.setting as OptionalSetting | undefined;
        row.hidden =
          collapsed || !isSectionVisible(setting, this.optionalSettings);
      });

    const button = this.host.querySelector<HTMLButtonElement>(
      `[data-collapse-parent="${parent}"]`,
    );
    if (button) {
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute(
        "aria-label",
        this.sidebarToggleLabel(collapsed, parent),
      );
      button.setAttribute("title", this.sidebarToggleLabel(collapsed, parent));
      const icon = button.querySelector<HTMLElement>("ha-icon");
      if (icon) icon.setAttribute("icon", this.sidebarToggleIcon(collapsed));
    }
  };

  private sectionStatus(status: SectionStatus | undefined) {
    if (!status) {
      return nothing;
    }

    return html`<span
      class="nc-section-status"
      data-status=${status}
      aria-hidden="true"
    ></span>`;
  }

  private sectionNavButtonClass(
    setting: OptionalSetting | undefined,
    parent: string | undefined,
  ): string {
    const classes = ["nc-section-nav-button"];
    if (setting) {
      classes.push("nc-optional-setting");
    }
    if (parent) {
      classes.push("nc-section-nav-child");
    }

    return classes.join(" ");
  }

  private sectionCollapseButton(hasChildren: boolean, title: string) {
    if (!hasChildren) {
      return nothing;
    }

    return html`<button
      class="nc-section-collapse-button"
      type="button"
      aria-label=${`Collapse ${title} subpanels`}
      title=${`Collapse ${title} subpanels`}
      aria-expanded="true"
      data-collapse-parent=${title}
      @click=${() => this.toggleSidebarChildren(title)}
    >
      <ha-icon icon="mdi:chevron-down"></ha-icon>
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

  private discardDraftTest = async (): Promise<void> => {
    const sessionId = this.draftTestSessionId;
    this.draftTestSessionId = null;
    if (!sessionId) return;
    try {
      await this.onDiscardTest(sessionId);
    } catch {
      // The server-side TTL releases drafts if this best-effort cleanup fails.
    }
  };

  private close = ({ force = false }: { force?: boolean } = {}): boolean => {
    if (!force && this.dirty && !window.confirm("Discard unsaved changes?"))
      return false;
    void this.discardDraftTest();
    this.host.remove();
    if (this.dashboardContent) this.dashboardContent.hidden = false;
    if (this.dashboardTabs) this.dashboardTabs.hidden = false;
    this.restoreDashboardAction();
    return true;
  };

  private formPayload = (): Alert => {
    const value = this.value;
    const conditions = this.conditionsForCurrentMode();
    let actions: Record<string, unknown>[] = [];
    if (this.optionalSettings.postConfirmationActions) {
      actions = actionArrayValue(
        this.host.querySelector<CodeEditor>('[data-role="actions"]'),
        "Post-confirmation actions",
      );
    }
    let notificationActions: Record<string, unknown>[] = [];
    if (this.optionalSettings.postSendActions) {
      notificationActions = actionArrayValue(
        this.host.querySelector<CodeEditor>(
          '[data-role="notification-actions"]',
        ),
        "Post-send actions",
      );
    }
    const confirmation = value.confirmation!;
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
      },
      notification: {
        target: this.recipients.target(),
        title: value.notification.title,
        message: value.notification.message,
      },
      confirmation: {
        enabled: Boolean(confirmation.enabled),
        button: confirmation.button,
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
        },
        actions: {
          enabled: Boolean(confirmation.actions.enabled),
        },
      },
      post_send_actions: {
        postSendActionsEnabled: Boolean(value.post_send_actions?.enabled),
      },
    };
    if (notificationActions.length) {
      payload.post_send_actions.actions = notificationActions;
    }
    if (actions.length) {
      payload.confirmation.actions.items = actions;
    }

    return buildAlertPayload(value, payload);
  };

  private yamlView = (): void => {
    showYaml(this.root, this.formPayload());
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
      this.host.querySelector<CodeEditor>(
        '[data-role="conditions-yaml-editor"]',
      )?.value || "[]"
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
            this.host.querySelector<CodeEditor>(
              '[data-role="conditions-yaml-editor"]',
            )?.value || "[]",
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
        this.host.querySelector<CodeEditor>(`[data-role="${role}"]`),
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
      await this.discardDraftTest();
      const result = await this.onTest(this.formPayload());
      this.draftTestSessionId = result.session_id;
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
      await this.discardDraftTest();
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
