import { css, html, LitElement, nothing } from "lit";
import type { TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import * as YAML from "yaml";
import type { Hass } from "../types.js";
import { localize } from "../localize.js";

export type CodeEditorSize = "content" | "page" | "modal";
export type CodeEditorVisualType = "trigger" | "condition" | "action";

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
  hass?: Hass;
  visualType?: CodeEditorVisualType;
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
    display: block;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    border: 1px solid var(--divider-color);
    border-radius: 10px;
    background: var(--secondary-background-color);
    overflow: hidden;
  }

  :host([data-size="content"]) {
    align-self: start;
    height: fit-content;
  }

  :host(.nc-code-editor-visual[data-size="content"]) {
    display: flex;
    flex-direction: column;
  }

  [hidden] {
    display: none !important;
  }

  ha-code-editor {
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    height: auto;
    min-height: 190px;
    max-height: min(48vh, 480px);
  }

  ha-selector {
    display: block;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }

  .visual-selector-frame {
    min-width: 0;
    padding: 12px;
  }

  .visual-error {
    padding: 16px;
    color: var(--error-color);
  }

  .mode-switch {
    display: flex;
    flex: 0 0 auto;
    gap: 2px;
    padding: 4px;
    border-bottom: 1px solid var(--divider-color);
    background: var(--secondary-background-color);
  }

  .mode-switch button {
    min-height: 32px;
    padding: 4px 12px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--primary-text-color);
    font: inherit;
    cursor: pointer;
  }

  .mode-switch button[aria-pressed="true"] {
    border-color: var(--divider-color);
    background: var(--card-background-color, var(--primary-background-color));
  }

  .mode-switch button:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }

  .editor-body {
    min-width: 0;
    min-height: 0;
    background: var(--secondary-background-color);
  }

  .editor-body.visual-active {
    box-sizing: border-box;
    padding: 8px;
  }

  :host([data-size="page"]) .editor-body,
  :host([data-size="modal"]) .editor-body {
    flex: 1 1 auto;
    overflow: auto;
  }

  :host([data-size="page"]),
  :host([data-size="modal"]) {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  :host([data-size="page"]) ha-code-editor,
  :host([data-size="modal"]) ha-code-editor {
    height: 100%;
    min-height: 0;
    max-height: none;
  }
`;

class HaNotificationsCodeEditor extends LitElement {
  static properties = {
    value: { attribute: false },
    mode: { type: String },
    language: { type: String },
    label: { type: String },
    hass: { attribute: false },
    visualType: { attribute: false },
    placeholder: { type: String },
    readOnly: { type: Boolean, attribute: "read-only" },
  };

  static styles = codeEditorStyles;

  declare value: string;
  declare mode: string;
  declare language: string;
  declare label: string;
  declare hass?: Hass;
  declare visualType?: CodeEditorVisualType;
  declare placeholder: string;
  declare readOnly: boolean;

  constructor() {
    super();
    this.value = "";
    this.mode = "yaml";
    this.language = "yaml";
    this.label = "";
    this.hass = undefined;
    this.visualType = undefined;
    this.placeholder = "";
    this.readOnly = false;
  }

  get codemirror(): { dom: HTMLElement } | undefined {
    return this.nativeEditor?.codemirror;
  }

  private get nativeEditor(): NativeCodeEditor | null {
    return this.renderRoot.querySelector<NativeCodeEditor>("ha-code-editor");
  }

  private viewMode: "yaml" | "visual" = "yaml";

  protected firstUpdated(): void {
    void this.sizeNativeEditor();
  }

  protected render() {
    const supportsVisual =
      this.language === "yaml" && this.visualType !== undefined;
    const visualValue = supportsVisual ? this.parseVisualValue() : null;
    const visualActive = supportsVisual && this.viewMode === "visual";
    return html`${
        supportsVisual
          ? html`<div
              class="mode-switch"
              role="group"
              aria-label=${localize(this.hass, "editor.visual.mode")}
            >
              <button
                aria-pressed=${this.viewMode === "yaml"}
                @click=${() => this.setViewMode("yaml")}
              >
                ${localize(this.hass, "editor.visual.yaml")}
              </button>
              <button
                aria-pressed=${this.viewMode === "visual"}
                @click=${() => this.setViewMode("visual")}
              >
                ${localize(this.hass, "editor.visual.visual")}
              </button>
            </div>`
          : nothing
      }
      <div class=${`editor-body${visualActive ? " visual-active" : ""}`}>
        <ha-code-editor
          ?hidden=${visualActive}
          .value=${this.value}
          mode=${this.mode}
          language=${this.language}
          aria-label=${this.label}
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder=${this.placeholder || nothing}
          ?read-only=${this.readOnly}
          @input=${this.forwardInput}
          @value-changed=${this.forwardValueChanged}
        ></ha-code-editor>
        ${
          visualActive
            ? visualValue === null
              ? html`<div class="visual-error" role="alert">
                  ${localize(this.hass, "editor.visual.invalid_yaml")}
                </div>`
              : html`<div class="visual-selector-frame">
                  <ha-selector
                    .hass=${this.hass}
                    .selector=${this.selectorConfig()}
                    .value=${visualValue}
                    data-role="native-visual-selector"
                    aria-label=${this.label}
                    @value-changed=${this.handleVisualValueChanged}
                  ></ha-selector>
                </div>`
            : nothing
        }
      </div>`;
  }

  private setViewMode(mode: "yaml" | "visual"): void {
    this.viewMode = mode;
    this.requestUpdate();
  }

  private parseVisualValue(): unknown[] | null {
    if (!this.value.trim()) return [];
    try {
      const value: unknown = YAML.parse(this.value);
      return Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }

  private selectorConfig(): Record<string, unknown> {
    return this.visualType ? { [this.visualType]: {} } : {};
  }

  private handleVisualValueChanged = (
    event: CustomEvent<{ value?: unknown }>,
  ): void => {
    event.stopPropagation();
    if (!Array.isArray(event.detail.value)) return;
    this.value = event.detail.value.length
      ? YAML.stringify(event.detail.value)
      : "";
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  };

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
    for (
      let frame = 0;
      frame < 30 && editor && !editor.codemirror;
      frame += 1
    ) {
      if (!this.isConnected) return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const dom = editor?.codemirror?.dom;
    if (!dom) return;
    const fillsAvailableSpace =
      this.dataset.size === "page" || this.dataset.size === "modal";
    dom.style.height = fillsAvailableSpace ? "100%" : "auto";
    dom.style.minHeight = fillsAvailableSpace ? "0" : "190px";
    dom.style.maxHeight = fillsAvailableSpace ? "none" : "min(48vh, 480px)";
    const scroller = dom.querySelector<HTMLElement>(".cm-scroller");
    if (scroller) {
      scroller.style.overflowX = "auto";
      scroller.style.overflowY = "auto";
    }
  }
}

if (!customElements.get("ha-notifications-code-editor")) {
  customElements.define(
    "ha-notifications-code-editor",
    HaNotificationsCodeEditor,
  );
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
  hass,
  visualType,
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
    class=${[
      "nc-code-editor",
      visualType ? "nc-code-editor-visual" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    .value=${value}
    mode=${mode}
    language=${language}
    aria-label=${label}
    .label=${label}
    .hass=${visualType ? hass : undefined}
    .visualType=${visualType}
    .placeholder=${placeholder}
    .readOnly=${readOnly}
    @input=${onInput || nothing}
    @value-changed=${onInput || nothing}
    ${ref((element) => {
      if (element) onReady?.(element as CodeEditor);
    })}
  ></ha-notifications-code-editor>`;
}
