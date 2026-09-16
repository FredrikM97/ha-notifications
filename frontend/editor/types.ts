import type { Alert, Hass } from "../types.js";

export type FormControl = EventTarget & { value: string };

export type CodeEditor = HTMLElement & {
  value: string;
  updateComplete?: Promise<unknown>;
  codemirror?: { dom: HTMLElement };
};

export interface CodeEditorOptions {
  role?: string;
  value: string;
  placeholder?: string;
  mode: string;
  language: string;
  label: string;
  className?: string;
  readOnly?: boolean;
  onInput?: (event: Event) => void;
}

export type EditorMode = "visual" | "yaml" | "jinja";

export interface EditorContext {
  hass: Hass;
  value: Alert;
  mode: EditorMode;
  markDirty(): void;
  refreshStatuses(): void;
  setMode(mode: EditorMode): void;
  validateCondition(): void;
  validateActions(role: string, label: string): void;
}

export type OptionalSetting =
  | "confirmation"
  | "confirmationReminder"
  | "confirmationNotification"
  | "postSendActions"
  | "postConfirmationActions";

export type OptionalSettings = Record<OptionalSetting, boolean>;
export type SectionStatus =
  | OptionalSetting
  | "confirmationReminder"
  | "confirmationNotification";

export interface EditorSection {
  title: string;
  setting?: OptionalSetting;
  parent?: string;
  status?: SectionStatus;
}

export interface OptionalSection {
  index: number;
}

export const editorSections: EditorSection[] = [
  { title: "Basic" },
  { title: "When to check" },
  { title: "Condition" },
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

export const optionalSections: Record<OptionalSetting, OptionalSection> = {
  postSendActions: { index: 5 },
  confirmation: { index: 6 },
  confirmationReminder: { index: 7 },
  confirmationNotification: { index: 8 },
  postConfirmationActions: { index: 9 },
};

export const ACTIONS_PLACEHOLDER = `- action: switch.turn_on
  metadata: {}
  target:
    entity_id:
      - switch.garage_door
      - light.living_room
  data: {}`;

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
