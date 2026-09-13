import { errorMessage, getYaml, saveYaml, validateYaml } from "./api.js";
import { html, render } from "lit";
import type { Hass } from "./types.js";

type Toast = (message: string, error?: boolean) => void;

type CodeEditor = HTMLElement & { value: string };

function codeEditor(root: ParentNode): CodeEditor {
  const editor = root.querySelector<CodeEditor>("ha-code-editor");
  if (!editor) {
    throw new Error("YAML editor is missing.");
  }
  return editor;
}

export function renderYamlView(
  container: HTMLElement,
  hass: Hass,
  showToast: Toast,
  refresh: () => Promise<void>,
): void {
  async function load(): Promise<void> {
    try {
      const result = await getYaml(hass);
      editor.value = result.yaml || "";
    } catch (err) {
      showToast(errorMessage(err), true);
    }
  }

  render(
    html`<div class="nc-card nc-yaml">
      <div class="nc-toolbar">
        <div>
          Advanced editor. Copy this YAML to another system, paste YAML from an
          existing configuration, or edit the file directly at
          /config/notification_center.yaml.
        </div>
        <div class="nc-actions">
          <button class="nc-button secondary" @click=${copyYaml}>Copy</button>
          <button class="nc-button secondary" @click=${pasteYaml}>Paste</button>
          <button class="nc-button secondary" @click=${validateYamlText}>
            Validate
          </button>
          <button class="nc-button secondary" @click=${load}>Reload</button>
          <button class="nc-button" @click=${saveYamlText}>Save YAML</button>
        </div>
      </div>
      <ha-code-editor
        id="nc-yaml-editor"
        class="nc-code-editor nc-yaml-editor"
        mode="yaml"
        language="yaml"
        aria-label="HA Notifications YAML"
      ></ha-code-editor>
    </div>`,
    container,
  );

  const editor = codeEditor(container);

  const readEditor = (): string => editor.value || "";

  async function copyYaml(): Promise<void> {
    try {
      await navigator.clipboard.writeText(readEditor());
      showToast("YAML copied to clipboard.");
    } catch (err) {
      showToast(errorMessage(err), true);
    }
  }

  async function pasteYaml(): Promise<void> {
    try {
      editor.value = await navigator.clipboard.readText();
      showToast("YAML pasted from clipboard.");
    } catch (err) {
      showToast(errorMessage(err), true);
    }
  }

  async function validateYamlText(event: Event): Promise<void> {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await validateYaml(hass, readEditor());
      showToast("YAML is valid.");
    } catch (err) {
      showToast(errorMessage(err), true);
    } finally {
      button.disabled = false;
    }
  }

  async function saveYamlText(event: Event): Promise<void> {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const result = await saveYaml(hass, readEditor());
      if (!result.saved) {
        throw new Error("The YAML was not saved.");
      }
      showToast("YAML saved and configuration reloaded.");
      await refresh();
    } catch (err) {
      showToast(errorMessage(err), true);
    } finally {
      button.disabled = false;
    }
  }

  void load();
}
