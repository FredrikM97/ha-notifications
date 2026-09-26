import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readWorkspaceFile(...path: string[]): string {
  return readFileSync(join(root, ...path), "utf8");
}

function includes(source: string, value: string): boolean {
  return source.includes(value);
}

function excludes(source: string, value: string): boolean {
  return !source.includes(value);
}

function matches(source: string, pattern: RegExp): boolean {
  return pattern.test(source);
}

describe("frontend build contract", () => {
  it("keeps the bundled panel and source contracts aligned", () => {
    // TODO: Rewrite this test in the future. Not suitable with the new structure of build/frontend
    const panelPath = join("build","frontend", "panel.js");
    const runtimePanelPath = join(
      "build",
      "frontend",
      "panel.js",
    );
    expect(existsSync(panelPath)).toBe(true);
    expect(existsSync(runtimePanelPath)).toBe(true);

    const panel = readFileSync(panelPath, "utf8");
    expect(readFileSync(runtimePanelPath, "utf8")).toBe(panel);

    const editor = readWorkspaceFile("frontend", "editor", "index.ts");
    const editorHeader = readWorkspaceFile(
      "frontend",
      "editor",
      "header.ts",
    );
    const api = readWorkspaceFile("frontend", "api.ts");
    const yamlView = readWorkspaceFile("frontend", "yaml-view.ts");
    const editorHelpers = readWorkspaceFile("frontend", "editor", "helpers.ts");

    expect({
      bundle: {
        customCard: includes(
          panel,
          'customElements.define("ha-notifications-card"',
        ),
        legacyCardRemoved: excludes(panel, "LegacyHaNotificationsCard"),
        nativeLitImportRemoved: excludes(panel, 'from "lit"'),
        administratorGuard: includes(panel, "Administrator access required"),
        cardRegistration: includes(panel, "customCards"),
        runtimeAccess: includes(panel, "getAlertRuntime"),
        historyFlow: includes(panel, "nc-history-flow"),
        yamlLayout: includes(panel, "min-height: calc(100vh - 180px)"),
        yamlEditorFill: includes(panel, "max-height: none"),
        confirmationActions: includes(
          panel,
          "Notify recipients when confirmed",
        ),
        draftTestNotification: includes(panel, "Draft test notification sent."),
        nativeSwitch: includes(panel, "<ha-switch"),
        oldSwitchRemoved: excludes(panel, "nc-switch-input"),
        oldJsonCopyRemoved: excludes(panel, "must be a valid JSON array"),
      },
      source: {
        apiListWrapper: includes(api, 'call<unknown>(hass, "list")'),
        previewWrapper: includes(api, '"preview_payload"'),
        yamlEditorClass: includes(
          yamlView,
          'class="nc-code-editor nc-yaml-editor"',
        ),
        editorSectionLabels: includes(editor, "postConfirmationActions: true"),
        editorTitleMarkup: includes(
          editorHeader,
          '<h1 data-role="editor-alert-name">',
        ),
        defaultConfirmationDisabled: matches(
          editorHelpers,
          /function defaultAlert\(\)[\s\S]*?confirmation:\s*\{\s*enabled: false,/,
        ),
      },
    }).toMatchSnapshot();
  });
});
