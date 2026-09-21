// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import type { Hass } from "../../frontend/types.js";
import { installHaTestElements, testUser } from "./conftest.js";

const getConfig = vi.fn().mockResolvedValue({ version: 1, alerts: [] });
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

describe("YAML view", () => {
  it("renders the registered view and loads configuration", async () => {
    const element = document.createElement("ha-notifications-yaml-view") as HTMLElement & {
      hass: Hass;
      showToast: (message: string, error?: boolean) => void;
      refreshPanel: () => Promise<void>;
      updateComplete: Promise<unknown>;
    };
    element.hass = {} as Hass;
    element.showToast = vi.fn();
    element.refreshPanel = vi.fn().mockResolvedValue(undefined);
    document.body.append(element);

    await vi.waitFor(() => expect(getConfig).toHaveBeenCalledOnce());
    await element.updateComplete;

    expect(element.querySelector(".nc-yaml")).toMatchSnapshot();
    expect(element.querySelector("ha-code-editor")?.getAttribute("mode")).toBe(
      "yaml",
    );
  });

  it("validates the current editor value", async () => {
    const element = document.createElement("ha-notifications-yaml-view") as HTMLElement & {
      hass: Hass;
      showToast: (message: string, error?: boolean) => void;
      refreshPanel: () => Promise<void>;
      updateComplete: Promise<unknown>;
    };
    element.hass = {} as Hass;
    element.showToast = vi.fn();
    element.refreshPanel = vi.fn().mockResolvedValue(undefined);
    document.body.append(element);

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
