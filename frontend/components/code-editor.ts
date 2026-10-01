import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";

export type CodeEditorSize = "content" | "page" | "modal";

type NativeCodeEditor = HTMLElement & {
  value: string;
  updateComplete?: Promise<unknown>;
  codemirror?: { dom: HTMLElement };
};

export interface CodeEditorOptions {
  role?: string;
  id?: string;
  value: string;
  placeholder?: string;
  mode: string;
  language: string;
  label: string;
  className?: string;
  size?: CodeEditorSize;
  readOnly?: boolean;
  onInput?: (event: Event) => void;
  onReady?: (editor: CodeEditor) => void;
}

export const codeEditorStyles = css`
  :host {
    --code-editor-background-color: var(--secondary-background-color);
    --code-editor-gutter-color: var(--secondary-background-color);
    --code-mirror-height: max(260px, min(820px, 75dvh));
    --code-mirror-min-height: 0;
    --code-mirror-max-height: none;
    display: block;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    border: 1px solid var(--divider-color);
    border-radius: 10px;
    overflow: hidden;
  }

  ha-code-editor {
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    height: auto;
    min-height: 0;
    max-height: none;
  }

  :host([data-size="page"]) {
    --code-mirror-height: max(360px, min(900px, calc(100dvh - 220px)));
    --code-mirror-min-height: 0;
    --code-mirror-max-height: none;
  }

  :host([data-size="modal"]) {
    --code-mirror-height: max(240px, min(650px, calc(100dvh - 220px)));
    --code-mirror-min-height: 0;
    --code-mirror-max-height: none;
  }

  @media (max-width: 600px) {
    :host {
      --code-mirror-height: max(240px, min(72dvh, 760px));
    }

    :host([data-size="page"]) {
      --code-mirror-height: max(220px, calc(100dvh - 200px));
    }
  }
`;

class HaNotificationsCodeEditor extends LitElement {
  static properties = {
    value: { attribute: false },
    mode: { type: String },
    language: { type: String },
    label: { type: String },
    placeholder: { type: String },
    readOnly: { type: Boolean, attribute: "read-only" },
  };

  static styles = codeEditorStyles;

  declare value: string;
  declare mode: string;
  declare language: string;
  declare label: string;
  declare placeholder: string;
  declare readOnly: boolean;

  constructor() {
    super();
    this.value = "";
    this.mode = "yaml";
    this.language = "yaml";
    this.label = "";
    this.placeholder = "";
    this.readOnly = false;
  }

  get codemirror(): { dom: HTMLElement } | undefined {
    return this.nativeEditor?.codemirror;
  }

  private get nativeEditor(): NativeCodeEditor | null {
    return this.renderRoot.querySelector<NativeCodeEditor>("ha-code-editor");
  }

  protected firstUpdated(): void {
    void this.sizeNativeEditor();
  }

  protected render() {
    return html`<ha-code-editor
      .value=${this.value}
      mode=${this.mode}
      language=${this.language}
      aria-label=${this.label}
      placeholder=${this.placeholder || nothing}
      ?read-only=${this.readOnly}
      @input=${this.forwardInput}
      @value-changed=${this.forwardValueChanged}
    ></ha-code-editor>`;
  }

  private forwardInput = (): void => {
    this.value = this.nativeEditor?.value || "";
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  };

  private forwardValueChanged = (event: CustomEvent): void => {
    this.value = this.nativeEditor?.value || "";
    this.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: event.detail,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private async sizeNativeEditor(): Promise<void> {
    await customElements.whenDefined("ha-code-editor");
    const editor = this.nativeEditor;
    await editor?.updateComplete;
    for (let frame = 0; frame < 30 && editor && !editor.codemirror; frame += 1) {
      if (!this.isConnected) return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const dom = editor?.codemirror?.dom;
    if (!dom) return;
    dom.style.height = "var(--code-mirror-height, auto)";
    dom.style.minHeight = "var(--code-mirror-min-height, 0)";
    dom.style.maxHeight = "var(--code-mirror-max-height, none)";
    const scroller = dom.querySelector<HTMLElement>(".cm-scroller");
    if (scroller) {
      scroller.style.overflowX = "auto";
      scroller.style.overflowY = "auto";
    }
  }
}

if (!customElements.get("ha-notifications-code-editor")) {
  customElements.define("ha-notifications-code-editor", HaNotificationsCodeEditor);
}

export type CodeEditor = HaNotificationsCodeEditor;

export interface CodeEditorOptions {
  role?: string;
  id?: string;
  value: string;
  placeholder?: string;
  mode: string;
  language: string;
  label: string;
  className?: string;
  size?: CodeEditorSize;
  readOnly?: boolean;
  onInput?: (event: Event) => void;
  onReady?: (editor: CodeEditor) => void;
}

export function codeEditor({
  role,
  id,
  value,
  placeholder = "",
  mode,
  language,
  label,
  className = "",
  size = "content",
  readOnly = false,
  onInput,
  onReady,
}: CodeEditorOptions): TemplateResult {
  return html`<ha-notifications-code-editor
    id=${id || nothing}
    data-role=${role || nothing}
    data-size=${size}
    class=${`nc-code-editor ${className}`.trim()}
    .value=${value}
    mode=${mode}
    language=${language}
    aria-label=${label}
    .label=${label}
    .placeholder=${placeholder}
    .readOnly=${readOnly}
    @input=${onInput || nothing}
    @value-changed=${onInput || nothing}
    ${ref((element) => {
      if (element) onReady?.(element as CodeEditor);
    })}
  ></ha-notifications-code-editor>`;
}
