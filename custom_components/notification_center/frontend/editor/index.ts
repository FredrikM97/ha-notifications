import { errorMessage } from "../api.js";
import { buildAlertPayload, type AlertFormValues } from "../alert-payload.js";
import { visualConditionBuilder } from "../condition-builder.js";
import { createRecipientPicker } from "../recipient-picker.js";
import { html, nothing, render } from "lit";
import type { Alert, Registries } from "../types.js";
import {
  clone,
  editorSections,
  optionalSections,
  type CodeEditor,
  type EditorContext,
  type EditorMode,
  type OptionalSection,
  type OptionalSetting,
  type OptionalSettings,
  type SectionStatus,
} from "./types.js";
import {
  actionArrayValue,
  conditionTemplate,
  conditionsYaml,
  defaultAlert,
  durationInputValue,
  editorModeFor,
  enabledLabel,
  fillActionEditors,
  isSectionVisible,
  parseConditionsYaml,
  sectionForSetting,
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
      removeSetting: this.removeSetting,
      setMode: this.setMode,
      validateCondition: this.validateCondition,
      validateActions: this.validateActions,
    };
    this.optionalSettings = {
      confirmation: !options.alert || Boolean(options.alert.confirmation),
      confirmationReminder:
        !options.alert || Boolean(options.alert?.confirmation?.reminders),
      confirmationNotification:
        !options.alert || Boolean(options.alert?.confirmation?.notification),
      postSendActions: true,
      postConfirmationActions:
        !options.alert || Boolean(options.alert.confirmation),
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
          <main class="nc-modal-body">
            <div class="nc-editor-layout">
              <nav class="nc-section-header" aria-label="Alert sections">
                <select
                  class="nc-add-setting"
                  aria-label="Add setting"
                  @change=${(event: Event) => this.addSetting(valueOf(event))}
                >
                  <option value="">Add setting</option>
                  <option
                    value="confirmation"
                    ?disabled=${optionalSettings.confirmation}
                  >
                    Confirmation
                  </option>
                </select>
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
    this.refreshStatuses();
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
  };

  private addSetting = (setting: string): void => {
    if (setting === "confirmation") {
      this.value.confirmation!.enabled = true;
      this.optionalSettings.confirmation = true;
      this.optionalSettings.confirmationReminder = true;
      this.optionalSettings.confirmationNotification = true;
      this.optionalSettings.postConfirmationActions = true;
    } else return;

    this.host
      .querySelectorAll<HTMLElement>(`[data-setting="${setting}"]`)
      .forEach((item) => (item.hidden = false));
    const select =
      this.host.querySelector<HTMLSelectElement>(".nc-add-setting");
    const option = select?.querySelector<HTMLOptionElement>(
      `option[value="${setting}"]`,
    );
    if (option) option.disabled = true;
    const sectionIndex = sectionForSetting(setting as OptionalSetting).index;
    const mobileOption = this.host.querySelector<HTMLOptionElement>(
      `.nc-section-select option[value="${sectionIndex}"]`,
    );
    if (mobileOption) mobileOption.disabled = false;
    if (setting === "confirmation") {
      this.setOptionalSettingVisible("postConfirmationActions", true);
    }
    if (select) select.value = "";
    this.markDirty();
    this.refreshStatuses();
  };

  private removeSetting = (setting: OptionalSetting): void => {
    if (setting === "postSendActions") {
      delete this.value.post_send_actions;
    } else if (setting === "confirmationReminder") {
      this.value.confirmation!.reminders.enabled = false;
    } else if (setting === "confirmationNotification") {
      this.value.confirmation!.notification.enabled = false;
    } else if (setting === "postConfirmationActions") {
      this.value.confirmation!.actions.items = [];
      this.value.confirmation!.actions.enabled = false;
    } else {
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
      };
      this.optionalSettings.postConfirmationActions = false;
      this.optionalSettings.confirmationReminder = false;
      this.optionalSettings.confirmationNotification = false;
      this.setOptionalSettingVisible("postConfirmationActions", false);
      this.setOptionalSettingVisible("confirmationReminder", false);
      this.setOptionalSettingVisible("confirmationNotification", false);
    }
    this.optionalSettings[setting] = false;
    this.setOptionalSettingVisible(setting, false);
    this.markDirty();
    this.showSection(0);
  };

  private setOptionalSettingVisible = (
    setting: OptionalSetting,
    visible: boolean,
  ): void => {
    this.host
      .querySelectorAll<HTMLElement>(`[data-setting="${setting}"]`)
      .forEach((item) => (item.hidden = !visible));
    const sectionIndex = sectionForSetting(setting).index;
    const mobileOption = this.host.querySelector<HTMLOptionElement>(
      `.nc-section-select option[value="${sectionIndex}"]`,
    );
    if (mobileOption) mobileOption.disabled = !visible;
    const addOption = this.host.querySelector<HTMLOptionElement>(
      `.nc-add-setting option[value="${setting}"]`,
    );
    if (addOption) addOption.disabled = visible;
  };

  private showSection = (index: number): void => {
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
