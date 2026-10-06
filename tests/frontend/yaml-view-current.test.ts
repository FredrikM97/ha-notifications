// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Hass } from "../../frontend/types.js";
import {
  configFixture,
  cleanupTestDom,
  homeAssistantFixture,
  mountCustomElement,
  settleElement,
} from "./conftest.js";

const api = vi.hoisted(() => ({
  errorMessage: (error: unknown) => String(error),
  getConfig: vi.fn(),
  reload: vi.fn(),
  saveConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock("../../frontend/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../frontend/api.js")>()),
  ...api,
}));

await import("../../frontend/views/yaml.js");

if (!customElements.get("ha-yaml-editor")) {
  customElements.define("ha-yaml-editor", class extends HTMLElement {
    hass?: Hass;
    defaultValue?: unknown;
    label = "";
    value: unknown;
  });
}

afterEach(() => {
  cleanupTestDom();
  vi.clearAllMocks();
});

type YamlView = HTMLElement & {
  hass: Hass;
  updateComplete: Promise<unknown>;
};

type YamlEditor = HTMLElement & {
  defaultValue: unknown;
  label: string;
  value: unknown;
};

function mountYamlView(): YamlView {
  api.getConfig.mockResolvedValue(configFixture);
  api.saveConfig.mockResolvedValue({ saved: true, config: configFixture });
  api.validateConfig.mockResolvedValue({});
  api.reload.mockResolvedValue({});
  return mountCustomElement<YamlView>("ha-notifications-yaml-view", {
    hass: homeAssistantFixture(),
  });
}

function editorFor(view: YamlView): YamlEditor {
  return view.shadowRoot!.querySelector("ha-yaml-editor") as YamlEditor;
}

function changeYaml(editor: YamlEditor, value: unknown, isValid = true): void {
  editor.value = value;
  editor.dispatchEvent(new CustomEvent("value-changed", {
    detail: { value, isValid },
    bubbles: true,
    composed: true,
  }));
}

describe("YAML view", () => {
  it("combines the title, help, icon actions and Save in one toolbar", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.getConfig).toHaveBeenCalledOnce());
    await settleElement(view);
    const toolbar = view.shadowRoot!.querySelector(".nc-toolbar")!;
    expect(toolbar.querySelector(".nc-yaml-title strong")?.textContent).toBe("HA Notifications YAML");
    const help = toolbar.querySelector("#yaml-help") as HTMLElement & { label: string };
    expect(help.label).toBe("About the YAML editor");
    expect(help.getAttribute("aria-describedby")).toBe("yaml-help-tooltip");
    const tooltip = toolbar.querySelector("ha-tooltip")!;
    expect(tooltip.getAttribute("for")).toBe("yaml-help");
    expect(tooltip.textContent).toContain("Advanced editor");
    expect(toolbar.querySelector("ha-icon-overflow-menu")).not.toBeNull();
    expect(toolbar.querySelector("ha-button")?.textContent?.trim()).toBe("Save YAML");
    expect(view.shadowRoot!.querySelectorAll(".nc-toolbar")).toHaveLength(1);
  });

  it("provides descriptive native tooltips for YAML toolbar actions", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.getConfig).toHaveBeenCalledOnce());
    await settleElement(view);
    const menu = view.shadowRoot!.querySelector("ha-icon-overflow-menu") as HTMLElement & {
      items: { label: string; tooltip: string }[];
    };
    expect(menu.items.map(({ label, tooltip }) => ({ label, tooltip }))).toEqual([
      { label: "Validate", tooltip: "Check this YAML configuration without saving it" },
      { label: "Reload", tooltip: "Reload automations and restore the saved configuration" },
    ]);
  });

  it("loads config into Home Assistant's YAML editor", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.getConfig).toHaveBeenCalledOnce());
    await settleElement(view);
    const editor = editorFor(view);

    expect(editor.defaultValue).toEqual(configFixture);
    expect(editor.label).toBe("");
    expect(editor.getAttribute("aria-label")).toBe("HA Notifications YAML");
    expect(editor.hasAttribute("copy-clipboard")).toBe(false);
  });

  it("validates the parsed value and reports the result with HA's snackbar event", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.getConfig).toHaveBeenCalledOnce());
    const value = { version: 1, alerts: [] };
    changeYaml(editorFor(view), value);
    let notification: unknown;
    view.addEventListener("hass-notification", (event) => {
      notification = (event as CustomEvent).detail;
    });
    const menu = view.shadowRoot!.querySelector("ha-icon-overflow-menu") as HTMLElement & {
      items: { label: string; action: () => void }[];
    };

    await menu.items.find(({ label }) => label === "Validate")!.action();

    expect(api.validateConfig).toHaveBeenCalledWith(view.hass, value);
    await vi.waitFor(() => expect(notification).toEqual({ message: "YAML is valid." }));
  });

  it("saves the parsed config and emits yaml-saved", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.getConfig).toHaveBeenCalledOnce());
    const value = { version: 1, alerts: [] };
    changeYaml(editorFor(view), value);
    let saved = false;
    view.addEventListener("yaml-saved", () => { saved = true; });

    view.shadowRoot!.querySelector("ha-button")!.dispatchEvent(
      new Event("click", { bubbles: true, composed: true }),
    );

    await vi.waitFor(() => expect(api.saveConfig).toHaveBeenCalledWith(view.hass, value));
    await vi.waitFor(() => expect(saved).toBe(true));
  });

  it("keeps invalid drafts in the editor and disables Save", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.getConfig).toHaveBeenCalledOnce());
    changeYaml(editorFor(view), "invalid yaml", false);
    await settleElement(view);

    expect(view.shadowRoot!.querySelector("ha-alert")?.textContent).toContain("not valid");
    expect(view.shadowRoot!.querySelector("ha-button")?.hasAttribute("disabled")).toBe(true);
    expect(editorFor(view).value).toBe("invalid yaml");
  });

  it("does not reload or discard YAML when Home Assistant state updates", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.getConfig).toHaveBeenCalledOnce());
    const editor = editorFor(view);
    const draft = { version: 1, alerts: [{ id: "draft" }] };
    changeYaml(editor, draft);

    view.hass = homeAssistantFixture();
    await settleElement(view);

    expect(api.getConfig).toHaveBeenCalledOnce();
    expect(editorFor(view)).toBe(editor);
    expect(editor.value).toEqual(draft);
  });
});