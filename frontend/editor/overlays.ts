import type { TemplateResult } from "lit";
import * as YAML from "yaml";
import type { Alert, Hass } from "../types.js";
import { localize } from "../localize.js";
import { codeEditor } from "../components/code-editor.js";
import type { CodeEditor } from "../components/code-editor.js";
import type { Toast } from "../components/toast.js";
import type { EditorModal } from "./modals.js";

interface ModalEventDetail {
  kind: "yaml";
  alert: Alert;
}

export class EditorOverlayController {
  private modal: EditorModal | null = null;
  private toasts: Toast[] = [];
  private yamlModalEditor?: CodeEditor;
  private readonly toastTimers = new Set<number>();
  private nextToastId = 0;

  constructor(
    private readonly root: ShadowRoot,
    private hass: Hass,
    private readonly onChange: () => void,
  ) {
    root.addEventListener("nc-editor-toast", this.handleToastEvent);
    root.addEventListener("nc-editor-modal", this.handleModalEvent);
  }

  get currentModal(): EditorModal | null {
    return this.modal;
  }

  get currentToasts(): Toast[] {
    return this.toasts;
  }

  setHass(hass: Hass): void {
    this.hass = hass;
  }

  closeModal = (): void => {
    this.modal = null;
    this.yamlModalEditor = undefined;
    this.onChange();
  };

  dispose(): void {
    this.root.removeEventListener("nc-editor-toast", this.handleToastEvent);
    this.root.removeEventListener("nc-editor-modal", this.handleModalEvent);
    for (const timer of this.toastTimers) window.clearTimeout(timer);
    this.toastTimers.clear();
  }

  private handleToastEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{
      message: string;
      duration: number;
    }>).detail;
    const toast: Toast = {
      id: ++this.nextToastId,
      message: detail.message,
      error: false,
    };
    this.toasts = [...this.toasts, toast];
    this.onChange();
    const timer = window.setTimeout(() => {
      this.toastTimers.delete(timer);
      this.toasts = this.toasts.filter((item) => item.id !== toast.id);
      this.onChange();
    }, detail.duration);
    this.toastTimers.add(timer);
  };

  private handleModalEvent = (event: Event): void => {
    const detail = (event as CustomEvent<ModalEventDetail>).detail;
    if (detail.kind === "yaml") {
      const title = localize(this.hass, "editor.common.alert_yaml");
      this.modal = {
        title,
        content: codeEditor({
          value: "",
          mode: "yaml",
          language: "yaml",
          label: title,
          className: "nc-alert-yaml-editor",
          size: "modal",
          onReady: (element) => {
            this.yamlModalEditor = element;
          },
        }),
        modalClass: "nc-alert-yaml-modal",
        closeLabel: localize(this.hass, "editor.common.close_yaml"),
        yaml: detail.alert,
      };
    } else {
      return;
    }

    this.onChange();
    if (this.modal.yaml) void this.prepareYamlModal(this.modal.yaml);
  };

  private async prepareYamlModal(alert: Alert): Promise<void> {
    await customElements.whenDefined("ha-code-editor");
    await this.yamlModalEditor?.updateComplete;
    if (!this.yamlModalEditor) return;
    this.yamlModalEditor.value = YAML.stringify(alert);
  }
}