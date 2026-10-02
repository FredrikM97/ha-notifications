// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import * as YAML from "yaml";
import {
  codeEditor,
  codeEditorStyles,
  type CodeEditorSize,
  type CodeEditorVisualType,
} from "../../frontend/components/code-editor.js";
import {
  cleanupTestDom,
  homeAssistantFixture,
  installHaTestElements,
  testUser,
} from "./conftest.js";
import type { Hass } from "../../frontend/types.js";

installHaTestElements();
afterEach(cleanupTestDom);

function modeButton(
  editor: HTMLElement & { shadowRoot: ShadowRoot },
  label: string,
): HTMLButtonElement {
  const button = [
    ...editor.shadowRoot.querySelectorAll<HTMLButtonElement>(
      ".mode-switch button",
    ),
  ].find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`${label} mode button is missing.`);
  return button;
}

async function mountEditor(
  language: string,
  value: string,
  visualType?: CodeEditorVisualType,
  size: CodeEditorSize = "content",
  hassOverride?: Hass,
) {
  const host = document.createElement("div");
  document.body.append(host);
  render(
    codeEditor({
      value,
      mode: language,
      language,
      label: "Actions",
      ...(visualType ? { hass: hassOverride || homeAssistantFixture() } : {}),
      visualType,
      size,
    }),
    host,
  );
  const editor = host.querySelector<
    HTMLElement & {
      value: string;
      updateComplete: Promise<unknown>;
      shadowRoot: ShadowRoot;
    }
  >("ha-notifications-code-editor");
  if (!editor) throw new Error("Code editor did not render.");
  await editor.updateComplete;
  return editor;
}

describe("shared code editor visual mode", () => {
  it("uses Home Assistant translations for the visual mode controls", async () => {
    const nativeTranslations: Record<string, string> = {
      "component.ha_notifications.frontend.editor.visual.mode": "Native mode",
      "component.ha_notifications.frontend.editor.visual.yaml": "Native YAML",
      "component.ha_notifications.frontend.editor.visual.visual": "Native visual",
    };
    const hass = homeAssistantFixture({
      localize: vi.fn((key: string) => nativeTranslations[key] || key),
    });
    const editor = await mountEditor(
      "yaml",
      "- trigger: state\n",
      "trigger",
      "content",
      hass,
    );

    expect(
      editor.shadowRoot.querySelector(".mode-switch")?.getAttribute("aria-label"),
    ).toBe("Native mode");
    expect(modeButton(editor, "Native YAML")).not.toBeNull();
    expect(modeButton(editor, "Native visual")).not.toBeNull();
    expect(hass.localize).toHaveBeenCalledWith(
      "component.ha_notifications.frontend.editor.visual.mode",
      {},
    );
  });

  it.each([
    {
      visualType: "trigger",
      input: [
        {
          trigger: "state",
          entity_id: "sensor.temperature",
          custom_field: "keep-me",
        },
      ],
      output: [
        {
          trigger: "state",
          entity_id: "sensor.humidity",
          custom_field: "keep-me",
        },
      ],
    },
    {
      visualType: "condition",
      input: [
        { condition: "state", entity_id: "binary_sensor.door", state: "on" },
      ],
      output: [
        { condition: "state", entity_id: "binary_sensor.door", state: "off" },
      ],
    },
    {
      visualType: "action",
      input: [
        {
          action: "light.turn_on",
          target: { entity_id: ["light.kitchen"] },
          data: { brightness: 120 },
        },
      ],
      output: [
        {
          action: "light.turn_on",
          target: { entity_id: ["light.kitchen"] },
          data: { brightness: 200 },
        },
      ],
    },
  ] as const)(
    "uses Home Assistant's $visualType selector",
    async ({ visualType, input, output }) => {
      const editor = await mountEditor(
        "yaml",
        YAML.stringify(input),
        visualType,
      );
      expect(editor.classList.contains("nc-code-editor-visual")).toBe(true);
      await testUser().click(modeButton(editor, "Visual"));
      await editor.updateComplete;

      expect(
        editor.shadowRoot.querySelector(".editor-body")?.classList.contains(
          "visual-active",
        ),
      ).toBe(true);
      expect(editor.classList.contains("nc-code-editor-visual-active")).toBe(true);
      expect(codeEditorStyles.cssText).toContain("padding: 0;");
      expect(codeEditorStyles.cssText).toContain(
        ":host(.nc-code-editor-visual-active)",
      );
      expect(codeEditorStyles.cssText).toContain(
        "border: 1px solid var(--divider-color);",
      );
      expect(codeEditorStyles.cssText).toContain("border-radius: 10px;");
      expect(codeEditorStyles.cssText).toContain(
        "--ha-card-border-width: 1px 0 0;",
      );
      expect(codeEditorStyles.cssText).toContain("box-sizing: border-box;");
      expect(codeEditorStyles.cssText).toContain("max-width: 100%;");
      expect(codeEditorStyles.cssText).not.toContain(
        "height: calc(min(48vh, 480px) + 44px);",
      );
      expect(codeEditorStyles.cssText).not.toContain(
        ':host(.nc-code-editor-visual[data-size="content"]) .editor-body',
      );

      const selector = editor.shadowRoot.querySelector<
        HTMLElement & {
          selector: Record<string, unknown>;
          value: unknown;
        }
      >('ha-selector[data-role="native-visual-selector"]');
      expect(selector?.parentElement?.classList.contains("visual-selector-frame")).toBe(true);
      expect(codeEditorStyles.cssText).toContain(".visual-selector-frame");
      expect(codeEditorStyles.cssText).toContain("padding: 8px;");
      expect(codeEditorStyles.cssText).toContain("background: var(--card-background-color);");
      expect(codeEditorStyles.cssText).toContain("border-radius: 8px;");
      expect(selector?.selector).toEqual({ [visualType]: {} });
      expect(selector?.value).toEqual(input);
      if (!selector) throw new Error("Home Assistant selector is missing.");

      selector.dispatchEvent(
        new CustomEvent("value-changed", {
          detail: { value: output },
          bubbles: true,
          composed: true,
        }),
      );

      expect(YAML.parse(editor.value)).toEqual(output);
    },
  );

  it("keeps invalid YAML accessible in code mode", async () => {
    const editor = await mountEditor("yaml", "- trigger: [broken\n", "trigger");
    await testUser().click(modeButton(editor, "Visual"));
    await editor.updateComplete;

    expect(
      editor.shadowRoot.querySelector('[role="alert"]')?.textContent,
    ).toContain("valid list");
    expect(editor.value).toBe("- trigger: [broken\n");

    await testUser().click(modeButton(editor, "YAML"));
    await editor.updateComplete;
    expect(editor.classList.contains("nc-code-editor-visual-active")).toBe(false);
    expect(
      editor.shadowRoot
        .querySelector("ha-code-editor")
        ?.getAttribute("language"),
    ).toBe("yaml");
  });

  it("does not offer visual mode for template editors", async () => {
    const editor = await mountEditor(
      "jinja",
      "{{ states('sensor.temperature') }}",
    );
    expect(editor.shadowRoot.querySelector(".mode-switch")).toBeNull();
    expect(editor.shadowRoot.querySelector("ha-code-editor")).not.toBeNull();
  });

  it("keeps whole-configuration YAML code-only and content-sized", async () => {
    const editor = await mountEditor("yaml", "version: 1\nalerts: []\n");
    expect(editor.shadowRoot.querySelector(".mode-switch")).toBeNull();
    expect((editor as HTMLElement & { hass?: unknown }).hass).toBeUndefined();
    expect(codeEditorStyles.cssText).toContain(':host([data-size="content"])');
    expect(codeEditorStyles.cssText).toContain("align-self: start;");
  });

  it("keeps the page CodeMirror mounted and full-height across view switches", async () => {
    const editor = await mountEditor(
      "yaml",
      "- trigger: state\n",
      "trigger",
      "page",
    );
    const codeMirror = editor.shadowRoot.querySelector<
      HTMLElement & {
        codemirror: { dom: HTMLElement };
      }
    >("ha-code-editor");
    if (!codeMirror) throw new Error("CodeMirror did not render.");
    await vi.waitFor(() =>
      expect(codeMirror.codemirror.dom.style.height).toBe("100%"),
    );

    await testUser().click(modeButton(editor, "Visual"));
    await editor.updateComplete;
    expect(codeMirror.hidden).toBe(true);
    expect(editor.shadowRoot.querySelector("ha-code-editor")).toBe(codeMirror);
    expect(codeMirror.codemirror.dom.style.height).toBe("100%");

    await testUser().click(modeButton(editor, "YAML"));
    await editor.updateComplete;
    expect(codeMirror.hidden).toBe(false);
    expect(codeMirror.codemirror.dom.style.height).toBe("100%");
  });
});
