import type { Alert, Hass } from "../types.js";
import { createLocalizer } from "../localize.js";
import { editorModeFor } from "./helpers.js";
import type {
  ActionEditorRole,
  EditorContext,
  EditorControlRole,
  EditorElements,
  EditorMode,
} from "./types.js";
import { editorSections } from "./types.js";

export interface EditorContextOptions {
  hass: Hass;
  value: Alert;
  elements: EditorElements;
  markDirty(): void;
  refreshStatuses(): void;
  setMode(mode: EditorMode): void;
  validateCondition(): void;
  validateActions(role: ActionEditorRole, label: string): void;
}

export function createEditorContext({
  hass,
  value,
  elements,
  markDirty,
  refreshStatuses,
  setMode,
  validateCondition,
  validateActions,
}: EditorContextOptions): EditorContext {
  return {
    hass,
    localize: createLocalizer(hass),
    value,
    mode: editorModeFor(value),
    activeSection: editorSections[0].title,
    setEditorElement: (role, element) => {
      if (role === "visual") elements.visual = element;
      if (role === "conditions-yaml") elements.conditionsYamlView = element;
      if (role === "jinja") elements.jinja = element;
      if (role === "recipients") elements.recipientMount = element;
    },
    setEditorControl: (role: EditorControlRole, element) => {
      if (role === "conditions-yaml") elements.conditionsYamlEditor = element;
      if (role === "post-confirmation-actions") {
        elements.postConfirmationActionsEditor = element;
      }
      if (role === "post-send-actions") {
        elements.postSendActionsEditor = element;
      }
    },
    markDirty,
    refreshStatuses,
    setMode,
    validateCondition,
    validateActions,
  };
}