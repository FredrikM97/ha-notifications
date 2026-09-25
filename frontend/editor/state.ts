import type { EditorModal } from "./modals.js";
import type { Toast } from "../toast.js";

export interface EditorState {
  dirty: boolean;
  discardDialogOpen: boolean;
  activeSectionIndex: number;
  mobileSectionsOpen: boolean;
  toasts: Toast[];
  modal: EditorModal | null;
}

export function createEditorState(): EditorState {
  return {
    dirty: false,
    discardDialogOpen: false,
    activeSectionIndex: 0,
    mobileSectionsOpen: false,
    toasts: [],
    modal: null,
  };
}