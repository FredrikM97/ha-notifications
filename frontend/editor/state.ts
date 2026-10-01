export interface EditorState {
  dirty: boolean;
  discardConfirmationOpen: boolean;
  activeSectionIndex: number;
}

export function createEditorState(): EditorState {
  return {
    dirty: false,
    discardConfirmationOpen: false,
    activeSectionIndex: 0,
  };
}