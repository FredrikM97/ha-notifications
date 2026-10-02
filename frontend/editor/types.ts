import type { Alert, Hass } from "../types.js";
import type { Localize } from "../localize.js";
import type { CodeEditor } from "../components/code-editor.js";

export type { CodeEditor, CodeEditorOptions } from "../components/code-editor.js";

export type FormControl = EventTarget & { value: string };

export type EditorMode = "yaml";

export type EditorControlRole =
  | "triggers-yaml"
  | "conditions-yaml"
  | "post-confirmation-actions"
  | "post-send-actions";

export type ActionEditorRole =
  | "post-confirmation-actions"
  | "post-send-actions";

export type EditorElementRole =
  | "triggers-yaml"
  | "conditions-yaml"
  | "recipients";

export interface EditorElements {
  triggersYamlView?: HTMLElement;
  visual?: HTMLElement;
  conditionsYamlView?: HTMLElement;
  jinja?: HTMLElement;
  recipientMount?: HTMLElement;
  conditionsYamlEditor?: CodeEditor;
  triggersYamlEditor?: CodeEditor;
  postConfirmationActionsEditor?: CodeEditor;
  postSendActionsEditor?: CodeEditor;
}

export interface EditorContext {
  hass: Hass;
  localize: Localize;
  value: Alert;
  mode: EditorMode;
  activeSection: string;
  setEditorElement(role: EditorElementRole, element: HTMLElement): void;
  setEditorControl(role: EditorControlRole, element: CodeEditor): void;
  syncTriggerEditor(value: string): void;
  markDirty(): void;
  refreshStatuses(): void;
  setMode(mode: EditorMode): void;
  validateCondition(): void;
  validateActions(role: ActionEditorRole, label: string): void;
}

export type EditorSectionContext<
  Additional extends keyof EditorContext = never,
> = Pick<
  EditorContext,
  "value" | "localize" | "activeSection" | "markDirty" | Additional
>;

export type ActionEditorSectionContext = EditorSectionContext<
  "hass" | "setEditorControl"
>;

export type OptionalSetting =
  | "confirmation"
  | "confirmationReminder"
  | "confirmationNotification"
  | "postSendActions"
  | "postConfirmationActions";

export type SectionStatus =
  | "triggers"
  | "conditions"
  | OptionalSetting
  | "confirmationReminder"
  | "confirmationNotification";

export interface EditorSection {
  title: string;
  setting?: OptionalSetting;
  parent?: string;
  status?: SectionStatus;
}

export const editorSections: EditorSection[] = [
  { title: "Basic" },
  { title: "When to run" },
  { title: "Triggers", parent: "When to run", status: "triggers" },
  { title: "Conditions", parent: "When to run", status: "conditions" },
  { title: "Recipients" },
  { title: "Notification" },
  {
    title: "Post-send actions",
    setting: "postSendActions",
    parent: "Notification",
    status: "postSendActions",
  },
  { title: "Confirmation", setting: "confirmation", status: "confirmation" },
  {
    title: "Reminder policy",
    setting: "confirmationReminder",
    parent: "Confirmation",
    status: "confirmationReminder",
  },
  {
    title: "Notify recipients when confirmed",
    setting: "confirmationNotification",
    parent: "Confirmation",
    status: "confirmationNotification",
  },
  {
    title: "Post-confirmation actions",
    setting: "postConfirmationActions",
    parent: "Confirmation",
    status: "postConfirmationActions",
  },
];

export const ACTIONS_PLACEHOLDER = `- action: switch.turn_on
  metadata: {}
  target:
    entity_id:
      - switch.garage_door
      - light.living_room
  data: {}`;

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
