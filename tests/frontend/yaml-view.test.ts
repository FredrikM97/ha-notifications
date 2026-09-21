// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import type { Hass } from "../../frontend/types.js";
import {
  installHaTestElements,
  configFixture,
  mountCustomElement,
  testUser,
} from "./conftest.js";

const getConfig = vi.fn().mockResolvedValue(configFixture);
const validateConfig = vi.fn().mockResolvedValue({});

vi.mock("../../frontend/api.js", () => ({
  errorMessage: (error: unknown) => String(error),
  getConfig,
  reload: vi.fn().mockResolvedValue({}),
  saveConfig: vi.fn().mockResolvedValue({ saved: true }),
  validateConfig,
}));

await import("../../frontend/yaml-view.js");

installHaTestElements();

type YamlViewTestElement = HTMLElement & {
  hass: Hass;
  showToast: (message: string, error?: boolean) => void;
  refreshPanel: () => Promise<void>;
  updateComplete: Promise<unknown>;
};

function mountYamlView(): YamlViewTestElement {
  return mountCustomElement<YamlViewTestElement>(
    "ha-notifications-yaml-view",
    {
      hass: {} as Hass,
      showToast: vi.fn(),
      refreshPanel: vi.fn().mockResolvedValue(undefined),
    },
  );
}

describe("YAML view", () => {
  it("renders the registered view and loads configuration", async () => {
    const element = mountYamlView();

    await vi.waitFor(() => expect(getConfig).toHaveBeenCalledOnce());
    await element.updateComplete;

    const editor = element.querySelector("ha-code-editor") as HTMLElement & {
      value: string;
    };
    expect({
      buttons: [...element.querySelectorAll(".nc-actions button")].map((button) =>
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

    await vi.waitFor(() => expect(getConfig).toHaveBeenCalled());
    const editor = element.querySelector("ha-code-editor") as HTMLElement & {
      value: string;
    };
    editor.value = "version: 1\nalerts: []";
    await testUser().click(within(element).getByRole("button", { name: "Validate" }));

    expect(validateConfig).toHaveBeenCalledWith(element.hass, {
      version: 1,
      alerts: [],
    });
  });
});
