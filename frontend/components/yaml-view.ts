import { css, html, LitElement, render } from "lit";
import { parse, stringify } from "yaml";
import {
  errorMessage,
  getConfig,
  reload,
  saveConfig,
  validateConfig,
} from "../api.js";
import type { Hass } from "../types.js";
import { buttonStyles } from "./button.js";
import { codeEditor, type CodeEditor } from "./code-editor.js";
import { localize } from "../localize.js";

export interface YamlToastEventDetail {
  message: string;
  error?: boolean;
}

export const yamlViewStyles = css`
  :host {
    display: block;
    container-type: inline-size;
    color: var(--primary-text-color);
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  button {
    font: inherit;
  }

  .nc-yaml {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: calc(100vh - 180px);
    padding: 16px;
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow);
  }

  .nc-toolbar {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
  }

  .nc-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  @container (max-width: 700px) {
    .nc-toolbar,
    .nc-actions {
      display: grid;
      grid-template-columns: 1fr;
      width: 100%;
    }

    .nc-button {
      width: 100%;
    }
  }

  @media (max-width: 700px) {
    .nc-toolbar,
    .nc-actions {
      display: grid;
      grid-template-columns: 1fr;
      width: 100%;
    }

    .nc-button {
      width: 100%;
    }
  }
`;

class YamlViewElement extends LitElement {
  declare hass: Hass;

  static properties = {
    hass: { attribute: false },
  };

  static styles = [buttonStyles, yamlViewStyles];

  private yaml = "";
  private busyAction: "reload" | "validate" | "save" | null = null;
  private editor: CodeEditor | null = null;
  private loadedHass: Hass | null = null;

  renderImmediately(): void {
    render(this.render(), this.renderRoot);
  }

  protected updated(): void {
    if (this.hass && !this.loadedHass) {
      this.loadedHass = this.hass;
      void this.load();
    }
  }

  async load(): Promise<void> {
    try {
      const config = await getConfig(this.hass);
      this.yaml = stringify(config);
      this.renderImmediately();
      await customElements.whenDefined("ha-code-editor");
      this.editor = this.renderRoot.querySelector<CodeEditor>(
        "ha-notifications-code-editor",
      );
      await this.editor?.updateComplete;
      if (this.editor) {
        this.editor.value = this.yaml;
      }
    } catch (err) {
      this.notify(errorMessage(err), true);
    }
  }

  protected render() {
    return html`<div class="nc-card nc-yaml">
      <div class="nc-toolbar">
        <div>
          ${localize(this.hass, "yaml.description")}
        </div>
        <div class="nc-actions">
          <button
            class="nc-button secondary"
            ?disabled=${this.busyAction !== null}
            @click=${this.copyYaml}
          >
            ${localize(this.hass, "yaml.copy")}
          </button>
          <button
            class="nc-button secondary"
            ?disabled=${this.busyAction !== null}
            @click=${this.validateYamlText}
          >
            ${localize(this.hass, "yaml.validate")}
          </button>
          <button
            class="nc-button secondary"
            ?disabled=${this.busyAction !== null}
            @click=${this.reloadYaml}
          >
            ${localize(this.hass, "yaml.reload")}
          </button>
          <button
            class="nc-button"
            ?disabled=${this.busyAction !== null}
            @click=${this.saveYamlText}
          >
            ${localize(this.hass, "yaml.save")}
          </button>
        </div>
      </div>
      ${codeEditor({
        id: "nc-yaml-editor",
        value: this.yaml,
        mode: "yaml",
        language: "yaml",
        label: localize(this.hass, "yaml.aria"),
        className: "nc-yaml-editor",
        size: "page",
        onInput: this.updateYaml,
        onReady: (editor) => {
          this.editor = editor;
        },
      })}
    </div>`;
  }

  private updateYaml = (event: Event): void => {
    this.yaml = (event.currentTarget as CodeEditor).value || "";
  };

  private parseEditor(): Record<string, unknown> {
    const value = parse(this.yaml);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("YAML must contain a mapping.");
    }
    return value as Record<string, unknown>;
  }

  private copyYaml = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(this.yaml);
      this.notify(localize(this.hass, "yaml.copied"));
    } catch (err) {
      this.notify(errorMessage(err), true);
    }
  };

  private reloadYaml = async (): Promise<void> => {
    this.busyAction = "reload";
    this.renderImmediately();
    try {
      await reload(this.hass);
      await this.load();
      this.notify(localize(this.hass, "yaml.reloaded"));
    } catch (err) {
      this.notify(errorMessage(err), true);
    } finally {
      this.busyAction = null;
      this.renderImmediately();
    }
  };

  private validateYamlText = async (): Promise<void> => {
    this.busyAction = "validate";
    this.renderImmediately();
    try {
      await validateConfig(this.hass, this.parseEditor());
      this.notify(localize(this.hass, "yaml.valid"));
    } catch (err) {
      this.notify(errorMessage(err), true);
    } finally {
      this.busyAction = null;
      this.renderImmediately();
    }
  };

  private saveYamlText = async (): Promise<void> => {
    this.busyAction = "save";
    this.renderImmediately();
    try {
      const result = await saveConfig(this.hass, this.parseEditor());
      if (!result.saved) {
        throw new Error(localize(this.hass, "yaml.not_saved"));
      }
      this.notify(localize(this.hass, "yaml.saved"));
      this.dispatchEvent(
        new CustomEvent("yaml-refresh-requested", {
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this.notify(errorMessage(err), true);
    } finally {
      this.busyAction = null;
      this.renderImmediately();
    }
  };

  private notify(message: string, error = false): void {
    this.dispatchEvent(
      new CustomEvent<YamlToastEventDetail>("yaml-toast", {
        detail: { message, error },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define("ha-notifications-yaml-view", YamlViewElement);
