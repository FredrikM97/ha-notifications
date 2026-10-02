// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { html, render } from "lit";
import { cleanupTestDom, installHaTestElements } from "./conftest.js";
import { panelStyles } from "../../frontend/panel.js";
import { editorComponentStyles } from "../../frontend/editor/component.js";
import { editorHeaderStyles } from "../../frontend/editor/header.js";
import { editorNavigationStyles } from "../../frontend/editor/navigation.js";
import { editorModalStyles } from "../../frontend/editor/modals.js";
import { editorSectionStyles } from "../../frontend/editor/section.js";
import { editorFooterStyles } from "../../frontend/editor/footer.js";
import { buttonStyles } from "../../frontend/components/button.js";
import { buttonComponentStyles } from "../../frontend/components/button.js";
import { codeEditor, codeEditorStyles } from "../../frontend/components/code-editor.js";
import { formFieldStyles } from "../../frontend/components/form-field.js";
import { settingToggleStyles } from "../../frontend/components/setting-toggle.js";
import { durationInputStyles } from "../../frontend/components/duration-input.js";
import { recipientPickerStyles } from "../../frontend/components/recipient-picker.js";
import { toastStyles } from "../../frontend/components/toast.js";
import { yamlViewStyles } from "../../frontend/components/yaml-view.js";
import {
  historyEntriesStyles,
  historyFilterStyles,
  historyViewStyles,
} from "../../frontend/components/history.js";
import { alertCardStyles } from "../../frontend/panel/alert-card.js";
import { alertListStyles } from "../../frontend/panel/alert-list.js";

afterEach(cleanupTestDom);
installHaTestElements();

describe("code editor styles", () => {
  it("keeps Lit host resets local to the panel and editor shells", () => {
    for (const styles of [panelStyles, editorComponentStyles]) {
      expect(styles.cssText).toContain("*::before");
      expect(styles.cssText).toContain("[hidden]");
      expect(styles.cssText).toContain("font: inherit");
    }
  });

  it("keeps code editor sizing out of the global stylesheet", () => {
    expect(panelStyles.cssText).not.toMatch(/ha-code-editor|\.nc-code-editor|--nc-code-editor-height/);
  });

  it("keeps recipient and toast presentation in their components", () => {
    expect(panelStyles.cssText).not.toMatch(
      /\.nc-recipient-|\.nc-target-(?:picker|chips|selection-label|chip)|\.nc-toast/,
    );
    expect(recipientPickerStyles.cssText).toContain(".nc-recipient-results");
    expect(recipientPickerStyles.cssText).toContain("@container (max-width: 700px)");
    expect(recipientPickerStyles.cssText).toContain("@media (max-width: 700px)");
    expect(toastStyles.cssText).toContain(".nc-toast.error");
  });

  it("keeps YAML view layout and controls in the YAML component", () => {
    expect(panelStyles.cssText).not.toMatch(/\.nc-yaml(?:\s|,|\{|$)|\.nc-toolbar/);
    expect(yamlViewStyles.cssText).toContain(".nc-yaml");
    expect(yamlViewStyles.cssText).toContain("height: calc(100dvh - 180px);");
    expect(yamlViewStyles.cssText).toContain(".nc-toolbar");
    expect(yamlViewStyles.cssText).not.toMatch(
      /\.nc-button\s*\{\s*display:\s*inline-flex/,
    );
    expect(buttonStyles.cssText).toContain(".nc-button.secondary");
    expect(yamlViewStyles.cssText).toContain("@container (max-width: 700px)");
    expect(yamlViewStyles.cssText).toContain("@media (max-width: 700px)");
  });

  it("keeps history presentation in the history component", () => {
    expect(panelStyles.cssText).not.toMatch(/\.nc-history(?:-|\s|\{|$)|\.nc-details/);
    expect(panelStyles.cssText).toContain(".nc-page.nc-mobile-full-page");
    expect(panelStyles.cssText).toContain("min-height: 100dvh;");
    expect(panelStyles.cssText).toContain("padding: 0;");
    expect(historyViewStyles.cssText).toContain(".nc-empty h2");
    expect(historyViewStyles.cssText).not.toContain(".nc-history-filter");
    expect(historyViewStyles.cssText).not.toContain(".nc-history-item");
    expect(historyFilterStyles.cssText).toContain(".nc-history-filter-details");
    expect(historyFilterStyles.cssText).toContain("@container (max-width: 700px)");
    expect(historyEntriesStyles.cssText).toContain(".nc-history-flow-group");
    expect(historyEntriesStyles.cssText).toContain(".nc-history-item");
    expect(historyEntriesStyles.cssText).not.toContain(".nc-history-filter");
  });

  it("keeps inline editors bounded and fills page or modal containers", () => {
    const componentStyles = codeEditorStyles.cssText;
    expect(componentStyles).not.toMatch(/\.cm-/);
    expect(componentStyles).toContain(
      "background: var(--secondary-background-color);",
    );
    expect(componentStyles).toContain(".editor-body");
    expect(componentStyles).toContain(
      ':host(.nc-code-editor-visual[data-size="content"])',
    );
    expect(componentStyles).toContain("overflow: auto;");
    expect(componentStyles).toContain("height: auto;");
    expect(componentStyles).toContain("min-height: 190px;");
    expect(componentStyles).toContain("max-height: min(48vh, 480px);");
    expect(componentStyles).toContain(':host([data-size="page"])');
    expect(componentStyles).toContain(':host([data-size="modal"])');
    expect(componentStyles).toContain("max-height: none;");
    expect(editorModalStyles.cssText).toContain("height: calc(100dvh - 48px);");
    expect(componentStyles).not.toMatch(/--code-mirror-height|\d+dvh/);
  });

  it("renders every editor with shared sizing and autocorrection disabled", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    render(
      html`${codeEditor({ value: "", mode: "yaml", language: "yaml", label: "Inline" })}
      ${codeEditor({ value: "", mode: "yaml", language: "yaml", label: "Page", size: "page", className: "nc-yaml-editor" })}
      ${codeEditor({ value: "", mode: "yaml", language: "yaml", label: "Modal", size: "modal" })}`,
      host,
    );

    const editors = [...host.querySelectorAll<HTMLElement & {
      updateComplete: Promise<unknown>;
      shadowRoot: ShadowRoot;
    }>("ha-notifications-code-editor")];
    await Promise.all(editors.map((editor) => editor.updateComplete));

    expect(
      editors.map((editor) => [
        editor.getAttribute("class"),
        editor.getAttribute("data-size"),
      ]),
    ).toEqual([
      ["nc-code-editor", "content"],
      ["nc-code-editor nc-yaml-editor", "page"],
      ["nc-code-editor", "modal"],
    ]);
    const nativeEditor = editors[0].shadowRoot.querySelector("ha-code-editor");
    await Promise.resolve();
    expect(nativeEditor?.getAttribute("autocorrect")).toBe("off");
    expect(nativeEditor?.getAttribute("autocapitalize")).toBe("off");
    expect(nativeEditor?.getAttribute("spellcheck")).toBe("false");
    expect(
      (nativeEditor as HTMLElement & { codemirror: { dom: HTMLElement } })
        .codemirror.dom.style.height,
    ).toBe("auto");
    expect(
      editors.slice(1).map((editor) =>
        (editor.shadowRoot.querySelector("ha-code-editor") as HTMLElement & {
          codemirror: { dom: HTMLElement };
        }).codemirror.dom.style.height,
      ),
    ).toEqual(["100%", "100%"]);
    host.remove();
  });
});

describe("alert editor styles", () => {
  it("keeps editor styles with the render modules that own the markup", () => {
    expect(panelStyles.cssText).not.toMatch(/\.nc-editor-|\.nc-condition-row|\.nc-section-nav-button/);
    expect(editorComponentStyles.cssText).toContain(".nc-editor-layout");
    expect(editorComponentStyles.cssText).toMatch(
      /\.nc-editor-sections\s*\{[^}]*padding:\s*24px;/,
    );
    expect(editorComponentStyles.cssText).not.toMatch(
      /\.nc-editor-sections\s*\{[^}]*border(?:-radius)?:/,
    );
    expect(editorHeaderStyles.cssText).toContain(".nc-editor-header");
    expect(editorComponentStyles.cssText).not.toContain(".nc-editor-header");
    expect(editorNavigationStyles.cssText).toContain(".nc-section-nav-button");
    expect(editorModalStyles.cssText).toContain(".nc-modal");
    expect(editorModalStyles.cssText).toContain(".nc-modal-backdrop");
    expect(editorComponentStyles.cssText).not.toMatch(/\.nc-modal\s*\{/);
    expect(formFieldStyles.cssText).toContain(":host");
    expect(formFieldStyles.cssText).not.toContain("width: min(100%, 14rem);");
    expect(editorSectionStyles.cssText).toContain(":host(.active)");
    expect(settingToggleStyles.cssText).toContain("ha-switch");
    expect(durationInputStyles.cssText).toContain("ha-selector");
    expect(editorFooterStyles.cssText).not.toContain(".nc-discard-confirmation");
    expect(editorModalStyles.cssText).toContain(".nc-discard-modal");
    expect(editorComponentStyles.cssText).toContain("@container (max-width: 900px)");
    expect(editorComponentStyles.cssText).toContain("@media (max-width: 900px)");
    expect(editorComponentStyles.cssText).toContain("min-height: 100dvh;");
    expect(editorComponentStyles.cssText).toContain("padding: 0;");
    expect(editorComponentStyles.cssText).toContain(".nc-modal-body");
    expect(editorHeaderStyles.cssText).toContain("@container (max-width: 900px)");
    expect(editorHeaderStyles.cssText).toContain("@media (max-width: 900px)");
    expect(editorNavigationStyles.cssText).toContain("@container (max-width: 900px)");
    expect(editorNavigationStyles.cssText).toContain("@media (max-width: 900px)");
    expect(editorNavigationStyles.cssText).toContain("align-self: stretch;");
    expect(editorNavigationStyles.cssText).toContain(
      "border-left: 1px solid var(--divider-color);",
    );
    expect(editorComponentStyles.cssText).toContain("@container (max-width: 480px)");
    expect(editorComponentStyles.cssText).toContain("@media (max-width: 480px)");
    expect(editorComponentStyles.cssText).toMatch(
      /\.nc-editor-view\s*\{\s*padding-inline:\s*0;/,
    );
    expect(editorComponentStyles.cssText).toMatch(
      /\.nc-editor-shell\s*\{\s*border-radius:\s*0;/,
    );
    expect(
      [editorComponentStyles, editorHeaderStyles, editorNavigationStyles, editorModalStyles, formFieldStyles, editorSectionStyles]
        .map((styles) => styles.cssText)
        .join("\n"),
    ).not.toMatch(/\.nc-condition-row|\.nc-evaluate-toggles|\.nc-yaml-utility/);
    expect(buttonStyles.cssText).toContain(".nc-button.secondary");
    expect(buttonStyles.cssText).toContain(".nc-icon-button");
    expect(buttonComponentStyles.cssText).toContain("button.secondary");
    expect(
      [editorComponentStyles, editorHeaderStyles, editorNavigationStyles, editorModalStyles, formFieldStyles, editorSectionStyles]
        .map((styles) => styles.cssText)
        .join("\n"),
    ).not.toMatch(/^\s*\.nc-button\s*\{/m);
  });
});

describe("alert card styles", () => {
  it("keeps alert and status rules in the responsive card component", () => {
    expect(panelStyles.cssText).not.toMatch(/\.nc-alert(?:\s|[.{:#])|\.nc-status/);
    expect(alertCardStyles.cssText).toContain(".nc-alert-actions");
    expect(alertCardStyles.cssText).toContain("background: var(--card-background-color)");
    expect(alertCardStyles.cssText).toContain(".nc-status.triggered");
    expect(alertCardStyles.cssText).toContain("container-type: inline-size");
    expect(alertCardStyles.cssText).toContain("@container (max-width: 700px)");
    expect(alertCardStyles.cssText).toContain("@media (max-width: 700px)");
    expect(alertListStyles.cssText).toContain(".nc-empty h2");
    expect(alertListStyles.cssText).toContain(
      "grid-template-columns: minmax(0, 1fr);",
    );
    expect(panelStyles.cssText).toContain(".nc-empty h2");
  });
});
