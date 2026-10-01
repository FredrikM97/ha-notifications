import { errorMessage } from "../api.js";
import { createRecipientPicker } from "../components/recipient-picker.js";
import { html, render } from "lit";
import type { Alert, Hass, Registries } from "../types.js";
import {
  clone,
  editorSections,
  type ActionEditorRole,
  type EditorContext,
  type EditorElements,
  type EditorMode,
  type OptionalSetting,
} from "./types.js";
import { actionArrayValue, parseConditionYaml, parseTriggerYaml } from "./serialization.js";
import { confirmationNotificationEnabled } from "./confirmation.js";
import { defaultAlert } from "./alert-defaults.js";
import { mergeCustomTriggers } from "./triggers.js";
import { showEditorToast, showYaml } from "./overlay-events.js";
import { buildEditorPayload } from "./payload.js";
import { EditorNavigationController } from "./navigation.js";
import { EditorOverlayController } from "./overlays.js";
import { createEditorState } from "./state.js";
import { createEditorContext } from "./context.js";
import { renderEditorView } from "./view.js";
import { createAlertEditorComponent } from "./component.js";

interface OpenEditorOptions {
  root: ShadowRoot;
  hass: Hass;
  alert?: Alert;
  registries: Registries;
  onSave: (alert: Alert) => Promise<Alert | void>;
  onSaved?: (alert: Alert) => Promise<void> | void;
  onClosed?: () => void;
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
  private readonly onValidateCondition: (alert: Alert) => Promise<unknown>;

  private readonly value: Alert;
  private readonly host = createAlertEditorComponent();
  private readonly context: EditorContext;
  private readonly elements: EditorElements = {};
  private readonly state = createEditorState();
  private readonly navigation: EditorNavigationController;
  private readonly overlays: EditorOverlayController;
  private postConfirmationActionsEnabled = false;

  private recipients!: ReturnType<typeof createRecipientPicker>;

  constructor(options: OpenEditorOptions) {
    this.root = options.root;
    this.registries = options.registries;
    this.onSave = options.onSave;
    this.onSaved = options.onSaved;
    this.onClosed = options.onClosed;
    this.onValidateCondition = options.onValidateCondition;

    this.value = clone(options.alert || defaultAlert());
    this.value.confirmation = {
      enabled: false,
      buttons: [{ id: "confirm", label: "Done" }],
      notification: { enabled: false, data: { message: "" } },
      reminders: {
        enabled: true,
        interval: "00:30:00",
        max_attempts: 5,
        show_attempts: false,
        forget_after_enabled: false,
        timeout: "00:15:00",
      },
      actions: { enabled: false, items: [] },
      ...this.value.confirmation,
    };
    const confirmationNotification =
      this.value.confirmation.notification || {
        enabled: false,
        data: { message: "" },
      };
    this.value.confirmation.notification = confirmationNotification;
    confirmationNotification.enabled = confirmationNotificationEnabled(
      confirmationNotification,
    );
    confirmationNotification.data = {
      ...confirmationNotification.data,
      message: String(
        confirmationNotification.data?.message ??
          confirmationNotification.message ??
          "",
      ),
    };
    this.postConfirmationActionsEnabled = Boolean(
      this.value.confirmation.actions.length,
    );

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
    this.navigation = new EditorNavigationController(
      this.showSection,
      this.renderEditor,
    );
    this.overlays = new EditorOverlayController(
      this.root,
      options.hass,
      this.renderEditor,
    );
    this.renderEditor();
    this.root.append(this.host);

    this.recipients = createRecipientPicker(
      this.registries,
      this.value.notification.target,
      this.context.markDirty,
      this.context.hass,
    );
    render(html`${this.recipients.element}`, this.elements.recipientMount);

    this.showSection(0);
  }

  private renderEditor = (): void => {
    const context = this.context;
    this.host.updateView(
      renderEditorView({
        header: {
          alert: this.value,
          context,
          postConfirmationActionsEnabled: this.postConfirmationActionsEnabled,
          activeSectionIndex: this.state.activeSectionIndex,
          sectionTitle: this.sectionLabel(
            editorSections[this.state.activeSectionIndex]?.parent,
            editorSections[this.state.activeSectionIndex]?.title || "",
          ),
          navigation: this.navigation,
          onToggleSetting: this.toggleOptionalSetting,
        },
        footer: {
          localize: context.localize,
          onYamlView: this.yamlView,
          onClose: this.close,
          validationLabel: this.validationLabel(),
          onValidate: this.validateCurrentSection,
          onSave: this.save,
          discardConfirmation: this.state.discardConfirmationOpen,
          onStay: this.closeDiscardDialog,
          onDiscard: this.discardChanges,
          dirty: this.state.dirty,
        },
        overlays: this.overlays,
      }),
    );
    this.updateDirtyIndicator();
  };

  private markDirty = (): void => {
    if (this.state.dirty) return;

    this.state.dirty = true;
    this.updateDirtyIndicator();
  };

  private updateDirtyIndicator = (): void => {
    const footer = this.host.shadowRoot?.querySelector<HTMLElement & {
      setDirtyState(dirty: boolean): void;
    }>("ha-notifications-editor-footer");
    footer?.setDirtyState(this.state.dirty);
  };

  private setMode = (mode: EditorMode): void => {
    if (this.context.mode === mode) return;

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
      this.postConfirmationActionsEnabled = enabled;
      this.value.confirmation!.actions = enabled
        ? this.value.confirmation!.actions
        : [];
    }
    this.markDirty();
    this.refreshStatuses();
  };

  private showSection = (index: number): void => {
    this.state.activeSectionIndex = index;
    this.context.activeSection = editorSections[index]?.title || "Basic";
    this.renderEditor();
  };
  private validationLabel = (): string => {
    const sectionTitle = editorSections[this.state.activeSectionIndex]?.title;
    if (sectionTitle === "Conditions") {
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

  private sectionLabel(parent: string | undefined, title: string): string {
    if (parent) {
      return `${parent} / ${title}`;
    }

    return title;
  }

  private showDiscardDialog = (): void => {
    if (this.state.discardConfirmationOpen) return;
    this.state.discardConfirmationOpen = true;
    this.renderEditor();
  };

  private closeDiscardDialog = (): void => {
    this.state.discardConfirmationOpen = false;
    this.renderEditor();
  };

  private discardChanges = (): void => {
    this.state.discardConfirmationOpen = false;
    this.close({ force: true });
  };

  private close = ({ force = false }: { force?: boolean } = {}): boolean => {
    if (!force && this.state.dirty) {
      this.showDiscardDialog();
      return false;
    }
    this.state.discardConfirmationOpen = false;
    this.navigation.dispose();
    this.overlays.dispose();
    this.host.remove();
    this.onClosed?.();
    return true;
  };

  private formPayload = (validate = true): Alert => {
    const value = this.value;
    const confirmationActions = actionArrayValue(
      this.elements.postConfirmationActionsEditor || null,
      "Post-confirmation actions",
    );
    const postSendActions = actionArrayValue(
      this.elements.postSendActionsEditor || null,
      "Post-send actions",
    );

    return buildEditorPayload({
      alert: value,
      condition: this.conditionForCurrentMode(),
      triggers: this.triggerForCurrentMode(),
      recipients: this.recipients.target(),
      confirmationActions,
      postSendActions,
      postSendActionsEnabled: Boolean(value.post_send_actions?.enabled),
      postConfirmationActionsEnabled: this.postConfirmationActionsEnabled,
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
      conditions: this.conditionForCurrentMode(),
    };
  };

  private conditionForCurrentMode(): Alert["conditions"] {
    return parseConditionYaml(this.conditionsYamlValue());
  }

  private triggerForCurrentMode(): Alert["triggers"] {
    return mergeCustomTriggers(
      this.value.triggers,
      parseTriggerYaml(this.triggersYamlValue()),
    );
  }

  private triggersYamlValue(): string {
    return this.elements.triggersYamlEditor?.value || "[]";
  }

  private conditionsYamlValue(): string {
    return (
      this.elements.conditionsYamlEditor?.value || "[]"
    );
  }

  private hasRequiredCondition = (): boolean => {
    try {
      const condition = parseConditionYaml(this.conditionsYamlValue());
      return condition.length > 0;
    } catch {
      return true;
    }
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
    if (sectionTitle === "Conditions") {
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

  private save = async (event: Event): Promise<void> => {
    const button = event.currentTarget as HTMLButtonElement;
    try {
      if (!this.value.name.trim()) throw new Error("Name is required.");
      if (!this.hasRequiredCondition())
        throw new Error("Condition is required.");
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
  if (
    options.root
      .querySelector("ha-notifications-alert-editor")
      ?.shadowRoot?.querySelector(".nc-editor-view")
  ) {
    return;
  }
  new AlertEditorController(options);
}
