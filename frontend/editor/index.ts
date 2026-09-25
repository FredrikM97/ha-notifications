import { errorMessage } from "../api.js";
import { visualConditionBuilder } from "../condition-builder.js";
import { createRecipientPicker } from "../recipient-picker.js";
import { localize } from "../localize.js";
import { html, render } from "lit";
import type { TemplateResult } from "lit";
import * as YAML from "yaml";
import { ref } from "lit/directives/ref.js";
import type { Alert, Hass, Registries } from "../types.js";
import {
  clone,
  editorSections,
  type ActionEditorRole,
  type CodeEditor,
  type EditorContext,
  type EditorElements,
  type EditorMode,
  type OptionalSetting,
  type OptionalSettings,
} from "./types.js";
import {
  actionArrayValue,
  checkedOf,
  constrainCodeEditor,
  conditionTemplate,
  conditionsYaml,
  defaultAlert,
  durationInputValue,
  fillActionEditors,
  parseConditionsYaml,
  showEditorToast,
  showYaml,
  valueOf,
} from "./helpers.js";
import { toastListTemplate, type Toast } from "../toast.js";
import { buildEditorPayload } from "./payload.js";
import { renderEditorNavigation } from "./navigation.js";
import { renderEditorSections } from "./sections.js";
import { renderEditorFooter } from "./footer.js";
import { renderEditorHeader } from "./header.js";
import {
  renderDiscardDialog,
  renderEditorModal,
} from "./modals.js";
import { createEditorState } from "./state.js";
import { createEditorContext } from "./context.js";

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
// state is one `this.` away instead of hidden in a captured variable.
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
  private readonly elements: EditorElements = {};
  private readonly state = createEditorState();
  private handleOutsideSectionPointer = (event: PointerEvent): void => {
    if (!this.state.mobileSectionsOpen) return;

    const path = event.composedPath();
    if (this.elements.mobileMenu && path.includes(this.elements.mobileMenu)) return;
    if (
      this.elements.sectionManageButton &&
      path.includes(this.elements.sectionManageButton)
    ) return;
    this.closeMobileSections();
  };

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

    this.context = createEditorContext({
      hass: options.hass,
      value: this.value,
      elements: this.elements,
      markDirty: this.markDirty,
      refreshStatuses: this.refreshStatuses,
      setMode: this.setMode,
      validateCondition: this.validateCondition,
      validateActions: this.validateActions,
    });
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
      this.elements.visual!,
      this.context.hass,
      this.registries,
      this.value.conditions,
      this.context.markDirty,
    );
    this.recipients = createRecipientPicker(
      this.registries,
      this.value.notification.target,
      this.context.markDirty,
      this.context.hass,
    );
    render(html`${this.recipients.element}`, this.elements.recipientMount);

    this.showSection(0);
  }

  private handleToastEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{ message: string; duration: number }>).detail;
    const toast: Toast = { id: Date.now(), message: detail.message, error: false };
    this.state.toasts = [...this.state.toasts, toast];
    this.renderEditor();
    window.setTimeout(() => {
      this.state.toasts = this.state.toasts.filter((item) => item.id !== toast.id);
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
      this.state.modal = {
        title: localize(this.context.hass, "editor.common.alert_yaml"),
        content: html`<ha-code-editor
          class="nc-code-editor nc-alert-yaml-editor"
          mode="yaml"
          language="yaml"
            aria-label=${localize(this.context.hass, "editor.common.alert_yaml")}
          .value=${""}
          ${ref((element) => {
            if (element) this.elements.yamlModalEditor = element as CodeEditor;
          })}
        ></ha-code-editor>`,
        modalClass: "nc-alert-yaml-modal",
          closeLabel: localize(this.context.hass, "editor.common.close_yaml"),
        yaml: detail.alert,
      };
    } else if (detail.title && detail.content) {
      this.state.modal = {
        title: detail.title,
        content: detail.content,
        modalClass: detail.modalClass || "",
          closeLabel: detail.closeLabel || localize(this.context.hass, "editor.common.close"),
      };
    }
    this.renderEditor();
    if (this.state.modal?.yaml) void this.prepareYamlModal(this.state.modal.yaml);
  };

  private async prepareYamlModal(alert: Alert): Promise<void> {
    await customElements.whenDefined("ha-code-editor");
    await this.elements.yamlModalEditor?.updateComplete;
    if (!this.elements.yamlModalEditor) return;
    constrainCodeEditor(this.elements.yamlModalEditor);
    this.elements.yamlModalEditor.value = YAML.stringify(alert);
  }

  private closeModal = (): void => {
    this.state.modal = null;
    this.elements.yamlModalEditor = undefined;
    this.renderEditor();
  };

  private renderEditor = (): void => {
    const optionalSettings = this.optionalSettings;
    const context = this.context;
    render(
      html`<div class="nc-editor-view">
        <section class="nc-editor-shell">
          ${renderEditorHeader({
            alert: this.value,
            context,
            optionalSettings,
            activeSectionIndex: this.state.activeSectionIndex,
            sectionTitle: this.sectionLabel(
              editorSections[this.state.activeSectionIndex]?.parent,
              editorSections[this.state.activeSectionIndex]?.title || "",
            ),
            mobileSectionsOpen: this.state.mobileSectionsOpen,
            onToggleSetting: this.toggleOptionalSetting,
            onToggleMobileSections: this.toggleMobileSections,
            onSectionManageButton: (element) => {
              this.elements.sectionManageButton = element;
            },
            renderNavigation: this.renderNavigation,
          })}
          <main class="nc-modal-body">
            <div class="nc-editor-layout">
              ${this.renderNavigation()}
              <div class="nc-editor-sections">
                ${renderEditorSections(context, optionalSettings)}
              </div>
            </div>
          </main>
          ${renderEditorFooter({
            localize: this.context.localize,
            onYamlView: this.yamlView,
            onClose: this.close,
            validationLabel: this.validationLabel(),
            onValidate: this.validateCurrentSection,
            onTest: this.test,
            onSave: this.save,
          })}
        </section>
        ${renderDiscardDialog(
          this.state.discardDialogOpen,
          this.context.localize,
          this.closeDiscardDialog,
          this.discardChanges,
        )}${renderEditorModal(this.state.modal, this.closeModal)}${toastListTemplate(
          this.state.toasts,
        )}
      </div>`,
      this.host,
    );
    this.updateDirtyIndicator();
  };

  private markDirty = (): void => {
    if (this.state.dirty) return;

    this.state.dirty = true;
    this.updateDirtyIndicator();
  };

  private updateDirtyIndicator = (): void => {
    const state = this.host.querySelector<HTMLElement>(".nc-editor-state");
    if (state) {
      state.textContent = this.state.dirty ? "Unsaved changes" : "All changes saved";
    }
  };

  private setMode = (mode: EditorMode): void => {
    if (this.context.mode === mode) return;

    if (mode === "yaml" && this.context.mode === "visual") {
      if (this.elements.conditionsYamlEditor) {
        this.elements.conditionsYamlEditor.value = conditionsYaml(
          this.visualConditions(),
        );
      }
    }

    this.context.mode = mode;
    this.state.dirty = true;
    this.renderEditor();
  };

  private refreshStatuses = (): void => {
    this.renderEditor();
  };

  private toggleOptionalSetting = (
    setting: OptionalSetting,
    enabled: boolean,
  ): void => {
    if (setting === "postSendActions") {
      this.value.post_send_actions = {
        enabled,
        actions: this.value.post_send_actions?.actions,
      };
    } else if (setting === "confirmation") {
      this.value.confirmation!.enabled = enabled;
    } else if (setting === "confirmationReminder") {
      this.value.confirmation!.reminders.enabled = enabled;
    } else if (setting === "confirmationNotification") {
      this.value.confirmation!.notification.enabled = enabled;
    } else {
      this.value.confirmation!.actions.enabled = enabled;
    }
    this.markDirty();
    this.refreshStatuses();
  };

  private renderNavigation = (className = "nc-section-header") =>
    renderEditorNavigation({
      localize: this.context.localize,
      alert: this.value,
      className,
      optionalSettings: this.optionalSettings,
      activeIndex: this.state.activeSectionIndex,
      mobileOpen: this.state.mobileSectionsOpen,
      collapsedParents: this.collapsedParents,
      onMobileMenuReady: (element) => {
        this.elements.mobileMenu = element;
      },
      onSelect: this.showSection,
      onToggleChildren: this.toggleSidebarChildren,
    });

  private showSection = (index: number): void => {
    this.state.activeSectionIndex = index;
    this.context.activeSection = editorSections[index]?.title || "Basic";
    this.closeMobileSections();
    this.renderEditor();
  };
  private validationLabel = (): string => {
    const sectionTitle = editorSections[this.state.activeSectionIndex]?.title;
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
    this.setMobileSectionsOpen(!this.state.mobileSectionsOpen);
  };

  private closeMobileSections = (): void => {
    this.setMobileSectionsOpen(false);
  };

  private setMobileSectionsOpen = (open: boolean): void => {
    if (this.state.mobileSectionsOpen === open) return;

    this.state.mobileSectionsOpen = open;
    this.renderEditor();
  };

  private sectionLabel(parent: string | undefined, title: string): string {
    if (parent) {
      return `${parent} / ${title}`;
    }

    return title;
  }

  private showDiscardDialog = (): void => {
    if (this.state.discardDialogOpen) return;
    this.state.discardDialogOpen = true;
    this.renderEditor();
  };

  private closeDiscardDialog = (): void => {
    this.state.discardDialogOpen = false;
    this.renderEditor();
  };

  private discardChanges = (): void => {
    this.state.discardDialogOpen = false;
    this.close({ force: true });
  };

  private close = ({ force = false }: { force?: boolean } = {}): boolean => {
    if (!force && this.state.dirty) {
      this.showDiscardDialog();
      return false;
    }
    this.state.discardDialogOpen = false;
    document.removeEventListener("pointerdown", this.handleOutsideSectionPointer);
    this.host.remove();
    this.onClosed?.();
    this.root.removeEventListener("nc-editor-toast", this.handleToastEvent);
    this.root.removeEventListener("nc-editor-modal", this.handleModalEvent);
    return true;
  };

  private formPayload = (validate = true): Alert => {
    const value = this.value;
    let confirmationActions: Record<string, unknown>[] = [];
    if (this.optionalSettings.postConfirmationActions) {
      confirmationActions = actionArrayValue(
        this.elements.postConfirmationActionsEditor || null,
        "Post-confirmation actions",
      );
    }
    let postSendActions: Record<string, unknown>[] = [];
    if (this.optionalSettings.postSendActions) {
      postSendActions = actionArrayValue(
        this.elements.postSendActionsEditor || null,
        "Post-send actions",
      );
    }

    return buildEditorPayload({
      alert: value,
      conditions: this.conditionsForCurrentMode(),
      recipients: this.recipients.target(),
      monitorInterval: this.monitorIntervalPayload(),
      confirmationActions,
      postSendActions,
      postSendActionsEnabled: Boolean(value.post_send_actions?.enabled),
      postConfirmationActionsEnabled: Boolean(
        value.confirmation?.actions.enabled,
      ),
      validate,
    });
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
      this.elements.conditionsYamlEditor?.value || "[]"
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
            this.elements.conditionsYamlEditor?.value || "[]",
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
    const sectionTitle = editorSections[this.state.activeSectionIndex]?.title;
    if (sectionTitle === "Condition") {
      await this.validateCondition();
      return;
    }

    if (sectionTitle === "Post-send actions") {
      this.validateActions("post-send-actions", "Post-send actions");
      return;
    }

    if (sectionTitle === "Post-confirmation actions") {
      this.validateActions(
        "post-confirmation-actions",
        "Post-confirmation actions",
      );
    }
  };

  private validateActions = (role: ActionEditorRole, label: string): void => {
    try {
      actionArrayValue(
        role === "post-confirmation-actions"
          ? this.elements.postConfirmationActionsEditor || null
          : this.elements.postSendActionsEditor || null,
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
      this.state.dirty = false;
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
