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
  request: vi.fn<typeof import("../../frontend/api.js").request>(),
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
  vi.unstubAllGlobals();
});

type YamlView = HTMLElement & {
  hass: Hass;
  updateComplete: Promise<unknown>;
  dirty: boolean;
  confirmLeave(): boolean;
};

type YamlEditor = HTMLElement & {
  defaultValue: unknown;
  label: string;
  value: unknown;
};

type YamlMenu = HTMLElement & {
  items: { label: string; action: () => Promise<void>; disabled: boolean }[];
};

function deferred<Response>() {
  let resolve!: (value: Response) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mountYamlView(implementation?: typeof import("../../frontend/api.js").request): YamlView {
  api.request.mockImplementation(implementation ?? (async <Response>(
    _hass: Hass,
    endpoint: string,
    payload: Record<string, unknown> = {},
  ): Promise<Response> => {
    if (endpoint === "get_config") return configFixture as Response;
    if (endpoint === "save_config") return { saved: true, config: payload.config } as Response;
    return {} as Response;
  }));
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
  it("bounds native editor dimensions without clipping its search or fullscreen controls", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
    const styles = (view.constructor as typeof HTMLElement & { styles: { toString(): string }[] })
      .styles.at(-1)!.toString();

    expect(styles).toContain("min-width: 0");
    expect(styles).toContain("max-width: 100%");
    expect(styles).toContain("--code-mirror-height: max(160px, calc(100dvh - 240px))");
    expect(styles).toContain("--code-mirror-max-height: max(160px, calc(100dvh - 240px))");
    expect(styles).not.toContain("overflow: hidden");
    expect(editorFor(view).hasAttribute("disable-fullscreen")).toBe(false);
  });

  it("combines the title, help, icon actions and Save in one toolbar", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
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
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
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
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledExactlyOnceWith(view.hass, "get_config"));
    await settleElement(view);
    const editor = editorFor(view);

    expect(editor.defaultValue).toEqual(configFixture);
    expect(editor.label).toBe("");
    expect(editor.getAttribute("aria-label")).toBe("HA Notifications YAML");
    expect(editor.hasAttribute("copy-clipboard")).toBe(false);
  });

  it("validates the parsed value and reports the result with HA's snackbar event", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
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

    expect(api.request).toHaveBeenCalledWith(view.hass, "validate_config", { config: value });
    await vi.waitFor(() => expect(notification).toEqual({ message: "YAML is valid." }));
  });

  it("saves the parsed config and emits yaml-saved", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
    const value = { version: 1, alerts: [] };
    changeYaml(editorFor(view), value);
    let saved = false;
    view.addEventListener("yaml-saved", () => { saved = true; });

    view.shadowRoot!.querySelector("ha-button")!.dispatchEvent(
      new Event("click", { bubbles: true, composed: true }),
    );

    await vi.waitFor(() => expect(api.request).toHaveBeenCalledWith(view.hass, "save_config", { config: value }));
    await vi.waitFor(() => expect(saved).toBe(true));
  });

  it("keeps invalid drafts in the editor and disables Save", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
    changeYaml(editorFor(view), "invalid yaml", false);
    await settleElement(view);

    expect(view.shadowRoot!.querySelector("ha-alert")?.textContent).toContain("not valid");
    expect(view.shadowRoot!.querySelector("ha-button")?.hasAttribute("disabled")).toBe(true);
    expect(editorFor(view).value).toBe("invalid yaml");
  });

  it("does not reload or discard YAML when Home Assistant state updates", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
    const editor = editorFor(view);
    const draft = { version: 1, alerts: [{ id: "draft" }] };
    changeYaml(editor, draft);

    view.hass = homeAssistantFixture();
    await settleElement(view);

    expect(api.request).toHaveBeenCalledOnce();
    expect(editorFor(view)).toBe(editor);
    expect(editor.value).toEqual(draft);
  });

  it("sends only one save request for repeated Save clicks in the same turn", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(editorFor(view)).not.toBeNull());
    const value = { version: 1, alerts: [] };
    changeYaml(editorFor(view), value);
    const pending = deferred<{ saved: boolean }>();
    api.request.mockImplementationOnce(async <Response>() => await pending.promise as Response);
    const saved = vi.fn();
    view.addEventListener("yaml-saved", saved);
    const save = view.shadowRoot!.querySelector("ha-button")!;

    save.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
    save.dispatchEvent(new Event("click", { bubbles: true, composed: true }));

    expect(api.request.mock.calls.filter(([, endpoint]) => endpoint === "save_config"))
      .toEqual([[view.hass, "save_config", { config: value }]]);
    expect(saved).not.toHaveBeenCalled();
    pending.resolve({ saved: true });
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    await settleElement(view);
    expect(view.shadowRoot!.querySelector("ha-button")!.hasAttribute("disabled")).toBe(false);
    expect(view.dirty).toBe(false);
  });

  it.each(["request rejection", "unsaved response"])(
    "disables pending actions, suppresses Validate/Reload, and allows retry after %s",
    async (failure) => {
      const view = mountYamlView();
      await vi.waitFor(() => expect(editorFor(view)).not.toBeNull());
      const value = { version: 1, alerts: [] };
      changeYaml(editorFor(view), value);
      const menu = view.shadowRoot!.querySelector("ha-icon-overflow-menu") as YamlMenu;
      const validate = menu.items.find(({ label }) => label === "Validate")!.action;
      const reload = menu.items.find(({ label }) => label === "Reload")!.action;
      const pending = deferred<{ saved: boolean }>();
      api.request.mockImplementationOnce(async <Response>() => await pending.promise as Response);
      const notifications = vi.fn();
      const saved = vi.fn();
      view.addEventListener("hass-notification", notifications);
      view.addEventListener("yaml-saved", saved);
      const save = view.shadowRoot!.querySelector("ha-button")!;

      save.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
      await validate();
      await reload();
      await settleElement(view);

      expect(api.request.mock.calls.map(([, endpoint]) => endpoint)).toEqual(["get_config", "save_config"]);
      expect(save.hasAttribute("disabled")).toBe(true);
      expect(menu.items.map(({ disabled }) => disabled)).toEqual([true, true]);
      expect(notifications).not.toHaveBeenCalled();
      if (failure === "request rejection") pending.reject(new Error("Save failed"));
      else pending.resolve({ saved: false });

      await vi.waitFor(() => expect(notifications).toHaveBeenCalledOnce());
      await settleElement(view);
      expect((notifications.mock.calls[0][0] as CustomEvent).detail.message)
        .toMatch(failure === "request rejection" ? /Save failed/ : /not saved/i);
      expect(saved).not.toHaveBeenCalled();
      expect(view.dirty).toBe(true);
      expect(save.hasAttribute("disabled")).toBe(false);
      expect(menu.items.map(({ disabled }) => disabled)).toEqual([false, false]);

      save.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
      await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
      await settleElement(view);
      expect(api.request.mock.calls.filter(([, endpoint]) => endpoint === "save_config"))
        .toEqual([
          [view.hass, "save_config", { config: value }],
          [view.hass, "save_config", { config: value }],
        ]);
      expect(notifications).toHaveBeenCalledTimes(2);
      expect((notifications.mock.calls[1][0] as CustomEvent).detail)
        .toEqual({ message: "YAML saved and configuration reloaded." });
      expect(view.dirty).toBe(false);
    },
  );

  it("reports only one error and no success when loading config after Reload fails", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(editorFor(view)).not.toBeNull());
    const pending = deferred<Record<string, unknown>>();
    api.request.mockImplementationOnce(async <Response>() => ({} as Response));
    api.request.mockImplementationOnce(async <Response>() => await pending.promise as Response);
    const notifications = vi.fn();
    view.addEventListener("hass-notification", notifications);
    const menu = view.shadowRoot!.querySelector("ha-icon-overflow-menu") as YamlMenu;

    const reloading = menu.items.find(({ label }) => label === "Reload")!.action();
    await vi.waitFor(() => expect(api.request.mock.calls.map(([, endpoint]) => endpoint))
      .toEqual(["get_config", "reload", "get_config"]));
    await settleElement(view);
    expect(editorFor(view)).toBeNull();
    expect(notifications).not.toHaveBeenCalled();
    pending.reject(new Error("Config load failed"));
    await reloading;
    await settleElement(view);

    expect(notifications).toHaveBeenCalledOnce();
    expect((notifications.mock.calls[0][0] as CustomEvent).detail)
      .toEqual({ message: "Error: Config load failed" });
    expect(view.shadowRoot!.querySelector("ha-button")!.hasAttribute("disabled")).toBe(false);
    expect(menu.items.map(({ disabled }) => disabled)).toEqual([false, false]);
  });

  it("preserves the native editor and newer dirty edits when an older save completes", async () => {
    const view = mountYamlView();
    await vi.waitFor(() => expect(editorFor(view)).not.toBeNull());
    const editor = editorFor(view);
    const oldEdit = { version: 1, alerts: [{ id: "old_edit" }] };
    const newEdit = { version: 1, alerts: [{ id: "new_edit" }] };
    changeYaml(editor, oldEdit);
    const pending = deferred<{ saved: boolean }>();
    api.request.mockImplementationOnce(async <Response>() => await pending.promise as Response);
    const saved = vi.fn();
    view.addEventListener("yaml-saved", saved);

    view.shadowRoot!.querySelector("ha-button")!.dispatchEvent(
      new Event("click", { bubbles: true, composed: true }),
    );
    await settleElement(view);
    changeYaml(editor, newEdit);
    pending.resolve({ saved: true });
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    await settleElement(view);

    expect(api.request).toHaveBeenCalledWith(view.hass, "save_config", { config: oldEdit });
    expect(editorFor(view)).toBe(editor);
    expect(editor.value).toBe(newEdit);
    expect(editor.defaultValue).toEqual(configFixture);
    expect(view.dirty).toBe(true);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    expect(view.confirmLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledExactlyOnceWith("You have unsaved YAML changes. Leave without saving?");

    view.shadowRoot!.querySelector("ha-button")!.dispatchEvent(
      new Event("click", { bubbles: true, composed: true }),
    );
    await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
    await settleElement(view);
    expect(api.request).toHaveBeenLastCalledWith(view.hass, "save_config", { config: newEdit });
    expect(editorFor(view)).toBe(editor);
    expect(view.dirty).toBe(false);
    confirm.mockClear();
    expect(view.confirmLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("reports initial load failure with a snackbar and no unhandled rejection", async () => {
    const pending = deferred<Record<string, unknown>>();
    const view = mountYamlView(async <Response>() => await pending.promise as Response);
    const notifications = vi.fn();
    const unhandled = vi.fn();
    view.addEventListener("hass-notification", notifications);
    window.addEventListener("unhandledrejection", unhandled);
    try {
      await vi.waitFor(() => expect(api.request).toHaveBeenCalledExactlyOnceWith(view.hass, "get_config"));
      pending.reject(new Error("Initial config load failed"));
      await vi.waitFor(() => expect(notifications).toHaveBeenCalledOnce());
      await settleElement(view);

      expect((notifications.mock.calls[0][0] as CustomEvent).detail)
        .toEqual({ message: "Error: Initial config load failed" });
      expect(unhandled).not.toHaveBeenCalled();
      expect(editorFor(view)).toBeNull();
      expect(view.dirty).toBe(false);
    } finally {
      window.removeEventListener("unhandledrejection", unhandled);
    }
  });

  it("does not create an editor for a load that completes after removal", async () => {
    const pending = deferred<Record<string, unknown>>();
    const view = mountYamlView(async <Response>() => await pending.promise as Response);
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledExactlyOnceWith(view.hass, "get_config"));
    await settleElement(view);
    const notifications = vi.fn();
    view.addEventListener("hass-notification", notifications);
    expect(editorFor(view)).toBeNull();

    view.remove();
    pending.resolve(configFixture);
    await pending.promise;
    await settleElement(view);
    expect(editorFor(view)).toBeNull();
    expect(view.dirty).toBe(false);
    document.body.append(view);
    await settleElement(view);

    expect(editorFor(view)).toBeNull();
    expect(api.request).toHaveBeenCalledOnce();
    expect(notifications).not.toHaveBeenCalled();
  });
});