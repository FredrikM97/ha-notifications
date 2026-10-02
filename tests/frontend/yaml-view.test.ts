// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import type { Hass } from "../../frontend/types.js";
import {
  installHaTestElements,
  configFixture,
  cleanupTestDom,
  mountCustomElement,
  testUser,
} from "./conftest.js";

const getConfig = vi.fn().mockResolvedValue(configFixture);
const validateConfig = vi.fn().mockResolvedValue({});
const saveConfig = vi.fn().mockResolvedValue({ saved: true });

vi.mock("../../frontend/api.js", () => ({
  errorMessage: (error: unknown) => String(error),
  getConfig,
  reload: vi.fn().mockResolvedValue({}),
  saveConfig,
  validateConfig,
}));

await import("../../frontend/components/yaml-view.js");

installHaTestElements();

afterEach(cleanupTestDom);

type YamlViewTestElement = HTMLElement & {
  hass: Hass;
  updateComplete: Promise<unknown>;
};

function mountYamlView(): YamlViewTestElement {
  return mountCustomElement<YamlViewTestElement>(
    "ha-notifications-yaml-view",
    {
      hass: {} as Hass,
    },
  );
}

describe("YAML view", () => {
  it("renders the registered view and loads configuration", async () => {
    const element = mountYamlView();

    await vi.waitFor(() => expect(getConfig).toHaveBeenCalledOnce());
    await element.updateComplete;

    const root = element.shadowRoot!;
    const editor = root.querySelector("ha-notifications-code-editor") as HTMLElement & {
      value: string;
      updateComplete: Promise<unknown>;
      shadowRoot: ShadowRoot;
    };
    await editor.updateComplete;
    expect(editor.shadowRoot.querySelector(".mode-switch")).toBeNull();
    expect({
      buttons: [...root.querySelectorAll(".nc-actions button")].map((button) =>
        button.textContent?.replace(/\s+/g, " ").trim(),
      ),
      editor: {
        ariaLabel: editor.getAttribute("aria-label"),
        language: editor.getAttribute("language"),
        mode: editor.getAttribute("mode"),
        value: editor.value,
      },
    }).toMatchSnapshot();
  });

  it("validates the current editor value", async () => {
    const element = mountYamlView();
    let toastDetail: { message: string; error?: boolean } | undefined;
    element.addEventListener("yaml-toast", (event) => {
      toastDetail = (event as CustomEvent<typeof toastDetail>).detail;
    });

    await vi.waitFor(() => expect(getConfig).toHaveBeenCalled());
    const editor = element.shadowRoot!.querySelector("ha-notifications-code-editor") as HTMLElement & {
      value: string;
    };
    editor.value = "version: 1\nalerts: []";
    await testUser().click(within(element.shadowRoot!).getByRole("button", { name: "Validate" }));

    expect(validateConfig).toHaveBeenCalledWith(element.hass, {
      version: 1,
      alerts: [],
    });
    await vi.waitFor(() => expect(toastDetail).toEqual({
      message: "YAML is valid.",
      error: false,
    }));
  });

  it("emits a panel refresh request after saving", async () => {
    const element = mountYamlView();
    let refreshRequested = false;
    element.addEventListener("yaml-refresh-requested", () => {
      refreshRequested = true;
    });

    await vi.waitFor(() => expect(getConfig).toHaveBeenCalled());
    const editor = element.shadowRoot!.querySelector(
      "ha-notifications-code-editor",
    ) as HTMLElement & { value: string };
    editor.value = "version: 1\nalerts: []";
    await testUser().click(
      element.shadowRoot!.querySelector<HTMLButtonElement>(
        ".nc-actions button:last-child",
      )!,
    );

    await vi.waitFor(() => expect(refreshRequested).toBe(true));
    expect(saveConfig).toHaveBeenCalledWith(element.hass, {
      version: 1,
      alerts: [],
    });
  });

  it("preserves pasted YAML when the view renders again", async () => {
    const element = mountYamlView();

    await vi.waitFor(() => expect(getConfig).toHaveBeenCalled());
    const editor = element.shadowRoot!.querySelector("ha-notifications-code-editor") as HTMLElement & {
      value: string;
    };
    const pastedYaml = "version: 1\nalerts: []\n";
    editor.value = pastedYaml;
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    element.renderImmediately();

    expect(editor.value).toBe(pastedYaml);
  });

  it("does not reload YAML when Home Assistant state updates", async () => {
    const element = mountYamlView();

    await vi.waitFor(() => expect(getConfig).toHaveBeenCalled());
    const editor = element.shadowRoot!.querySelector("ha-notifications-code-editor") as HTMLElement & {
      value: string;
    };
    const pastedYaml = "version: 1\nalerts: []\n";
    editor.value = pastedYaml;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    const loadCount = getConfig.mock.calls.length;

    element.hass = {} as Hass;
    await element.updateComplete;

    expect(getConfig).toHaveBeenCalledTimes(loadCount);
    expect(editor.value).toBe(pastedYaml);
  });
});
