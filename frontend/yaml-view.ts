import { parse, stringify } from "yaml";
import {
  errorMessage,
  getConfig,
  reload,
  saveConfig,
  validateConfig,
} from "./api.js";
import { html, LitElement, render } from "lit";
import { ref } from "lit/directives/ref.js";
import type { Hass } from "./types.js";
import { constrainCodeEditor } from "./editor/helpers.js";

type Toast = (message: string, error?: boolean) => void;

type CodeEditor = HTMLElement & {
  value: string;
  updateComplete?: Promise<unknown>;
};

class YamlViewElement extends LitElement {
  hass!: Hass;

  showToast!: Toast;

  refreshPanel!: () => Promise<void>;

  static properties = {
    hass: { attribute: false },
    showToast: { attribute: false },
    refreshPanel: { attribute: false },
  };

  private yaml = "";
  private busyAction: "reload" | "validate" | "save" | null = null;
  private editor: CodeEditor | null = null;
  private loadedHass: Hass | null = null;

  protected createRenderRoot(): HTMLElement {
    return this;
  }

  renderImmediately(): void {
    render(this.render(), this);
  }

  protected updated(): void {
    if (this.hass && this.hass !== this.loadedHass) {
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
      await this.editor?.updateComplete;
      if (this.editor) {
        constrainCodeEditor(this.editor);
      }
    } catch (err) {
      this.showToast(errorMessage(err), true);
    }
  }

  protected render() {
    return html`<div class="nc-card nc-yaml">
      <div class="nc-toolbar">
        <div>
          Advanced editor. Copy this YAML to another system or import a
          validated configuration into Home Assistant.
        </div>
        <div class="nc-actions">
          <button
            class="nc-button secondary"
            ?disabled=${this.busyAction !== null}
            @click=${this.copyYaml}
          >
            Copy
          </button>
          <button
            class="nc-button secondary"
            ?disabled=${this.busyAction !== null}
            @click=${this.validateYamlText}
          >
            Validate
          </button>
          <button
            class="nc-button secondary"
            ?disabled=${this.busyAction !== null}
            @click=${this.reloadYaml}
          >
            Reload
          </button>
          <button
            class="nc-button"
            ?disabled=${this.busyAction !== null}
            @click=${this.saveYamlText}
          >
            Save YAML
          </button>
        </div>
      </div>
      <ha-code-editor
        id="nc-yaml-editor"
        class="nc-code-editor nc-yaml-editor"
        mode="yaml"
        language="yaml"
        aria-label="HA Notifications YAML"
        .value=${this.yaml}
        @input=${this.updateYaml}
        @value-changed=${this.updateYaml}
        ${ref((editor: CodeEditor) => {
          this.editor = editor;
        })}
      ></ha-code-editor>
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
      this.showToast("YAML copied to clipboard.");
    } catch (err) {
      this.showToast(errorMessage(err), true);
    }
  };

  private reloadYaml = async (): Promise<void> => {
    this.busyAction = "reload";
    this.renderImmediately();
    try {
      await reload(this.hass);
      await this.load();
      this.showToast("YAML configuration reloaded.");
    } catch (err) {
      this.showToast(errorMessage(err), true);
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
      this.showToast("YAML is valid.");
    } catch (err) {
      this.showToast(errorMessage(err), true);
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
        throw new Error("The YAML was not saved.");
      }
      this.showToast("YAML saved and configuration reloaded.");
      await this.refreshPanel();
    } catch (err) {
      this.showToast(errorMessage(err), true);
    } finally {
      this.busyAction = null;
      this.renderImmediately();
    }
  };
}

export function renderYamlView(
  container: HTMLElement,
  hass: Hass,
  showToast: Toast,
  refresh: () => Promise<void>,
): void {
  let element: YamlViewElement | undefined;
  render(
    html`<ha-notifications-yaml-view
      .hass=${hass}
      .showToast=${showToast}
      .refreshPanel=${refresh}
      ${ref((value) => {
        element = value as YamlViewElement;
      })}
    ></ha-notifications-yaml-view>`,
    container,
  );
  element?.renderImmediately();
  void element?.load();
}
