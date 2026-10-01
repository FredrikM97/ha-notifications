// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { html, render } from "lit";
import { panelStyles } from "../../frontend/panel.js";
import { editorComponentStyles } from "../../frontend/editor/component.js";
import { editorHeaderStyles } from "../../frontend/editor/header.js";
import { editorNavigationStyles } from "../../frontend/editor/navigation.js";
import { editorModalStyles } from "../../frontend/editor/modals.js";
import { editorSectionStyles } from "../../frontend/editor/section.js";
import { editorFooterStyles } from "../../frontend/editor/footer.js";
import { buttonStyles } from "../../frontend/components/button.js";
import { buttonComponentStyles } from "../../frontend/components/button.js";
import { sharedStyles } from "../../frontend/components/shared-styles.js";
import { codeEditor, codeEditorStyles } from "../../frontend/components/code-editor.js";
import { formFieldStyles } from "../../frontend/components/form-field.js";
import { settingToggleStyles } from "../../frontend/components/setting-toggle.js";
import { durationInputStyles } from "../../frontend/components/duration-input.js";
import { recipientPickerStyles } from "../../frontend/components/recipient-picker.js";
import { toastStyles } from "../../frontend/components/toast.js";
import { yamlViewStyles } from "../../frontend/components/yaml-view.js";
import { historyViewStyles } from "../../frontend/components/history.js";
import { alertCardStyles } from "../../frontend/panel/alert-card.js";

describe("code editor styles", () => {
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
    expect(historyViewStyles.cssText).toContain(".nc-history-flow-group");
    expect(historyViewStyles.cssText).not.toMatch(/^\s*\.nc-button\s*\{/m);
    expect(historyViewStyles.cssText).toContain("@container (max-width: 700px)");
    expect(sharedStyles.cssText).toContain(".nc-empty h2");
  });

  it("sizes editors only through inherited CodeMirror variables", () => {
    const componentStyles = codeEditorStyles.cssText;
    expect(componentStyles).not.toMatch(/\.cm-/);
    expect(componentStyles).toMatch(
      /:host \{[^}]*--code-mirror-height: max\(260px, min\(820px, 75dvh\)\);[^}]*--code-mirror-max-height: none;/,
    );
    expect(componentStyles).toMatch(
      /:host\(\[data-size="page"\]\) \{[^}]*--code-mirror-height: max\(360px, min\(900px, calc\(100dvh - 220px\)\)\);/,
    );
    expect(componentStyles).toMatch(
      /:host\(\[data-size="modal"\]\) \{[^}]*--code-mirror-height: max\(240px, min\(650px, calc\(100dvh - 220px\)\)\);/,
    );
  });

  it("renders every editor with the shared class and a size", () => {
    const host = document.createElement("div");
    render(
      html`${codeEditor({ value: "", mode: "yaml", language: "yaml", label: "Inline" })}
      ${codeEditor({ value: "", mode: "yaml", language: "yaml", label: "Page", size: "page", className: "nc-yaml-editor" })}`,
      host,
    );

    expect(
      Array.from(host.querySelectorAll("ha-notifications-code-editor"), (editor) => [
        editor.getAttribute("class"),
        editor.getAttribute("data-size"),
      ]),
    ).toEqual([
      ["nc-code-editor", "content"],
      ["nc-code-editor nc-yaml-editor", "page"],
    ]);
  });
});

describe("alert editor styles", () => {
  it("keeps editor styles with the render modules that own the markup", () => {
    expect(panelStyles.cssText).not.toMatch(/\.nc-editor-|\.nc-condition-row|\.nc-section-nav-button/);
    expect(editorComponentStyles.cssText).toContain(".nc-editor-layout");
    expect(editorHeaderStyles.cssText).toContain(".nc-editor-header");
    expect(editorComponentStyles.cssText).not.toContain(".nc-editor-header");
    expect(editorNavigationStyles.cssText).toContain(".nc-section-nav-button");
    expect(editorModalStyles.cssText).toContain(".nc-modal");
    expect(editorModalStyles.cssText).toContain(".nc-modal-backdrop");
    expect(editorComponentStyles.cssText).not.toContain(".nc-modal");
    expect(formFieldStyles.cssText).toContain(":host");
    expect(editorSectionStyles.cssText).toContain(":host(.active)");
    expect(settingToggleStyles.cssText).toContain("ha-switch");
    expect(durationInputStyles.cssText).toContain("ha-selector");
    expect(editorFooterStyles.cssText).toContain(".nc-discard-confirmation");
    expect(editorComponentStyles.cssText).not.toContain(".nc-discard-confirmation");
    expect(editorComponentStyles.cssText).toContain("@container (max-width: 700px)");
    expect(editorComponentStyles.cssText).toContain("@media (max-width: 700px)");
    expect(
      [editorComponentStyles, editorHeaderStyles, editorNavigationStyles, editorModalStyles, formFieldStyles, editorSectionStyles]
        .map((styles) => styles.cssText)
        .join("\n"),
    ).not.toMatch(/\.nc-condition-row|\.nc-evaluate-toggles|\.nc-yaml-utility/);
    expect(buttonStyles.cssText).toContain(".nc-button.secondary");
    expect(buttonStyles.cssText).toContain(".nc-icon-button");
    expect(buttonComponentStyles.cssText).toContain("button.secondary");
    expect(sharedStyles.cssText).not.toContain(".nc-button");
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
    expect(alertCardStyles.cssText).toContain(".nc-status.active");
    expect(alertCardStyles.cssText).toContain("container-type: inline-size");
    expect(alertCardStyles.cssText).toContain("@container (max-width: 700px)");
    expect(alertCardStyles.cssText).toContain("@media (max-width: 700px)");
    expect(sharedStyles.cssText).toContain(".nc-card");
  });
});
