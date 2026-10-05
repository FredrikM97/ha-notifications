// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { openEditor } from "../../frontend/editor/index.js";
import { editableAlert, finalizeAlert } from "../../frontend/editor/alert-model.js";
import { editorSections, type EditorState } from "../../frontend/editor/sections.js";
import {
  cleanupTestDom,
  draftAlertFixture,
  editorRoot,
  homeAssistantFixture,
  settleElement,
  testUser,
} from "./conftest.js";

let resize: ResizeObserverCallback;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanupTestDom();
  vi.unstubAllGlobals();
});

async function mount(
  loadFragmentTranslation = vi.fn().mockResolvedValue(undefined),
  sendMessagePromise = vi.fn().mockResolvedValue({ platforms: [], unknown: true }),
) {
  const root = editorRoot();
  const alert = draftAlertFixture();
  openEditor({
    root,
    hass: homeAssistantFixture({ loadFragmentTranslation, connection: { sendMessagePromise } as never }),
    alert,
    users: [],
    onSave: vi.fn(),
    onValidateAlert: vi.fn(),
  });
  const editor = root.querySelector<LitElement>("ha-notifications-alert-editor")!;
  await settleElement(editor);
  return { editor, alert };
}

describe("native editor controls", () => {
  it("groups mobile settings independently and keeps post-send actions under Notification", () => {
    expect(editorSections.find(section => section.key === "mobile")!.parent).toBeUndefined();
    expect(editorSections.find(section => section.key === "android")!.parent).toBe("mobile");
    expect(editorSections.find(section => section.key === "ios")!.parent).toBe("mobile");
    expect(editorSections.find(section => section.key === "postSendActions")!.parent).toBe("notification");
    const keys = editorSections.map(section => section.key);
    expect(keys.slice(keys.indexOf("notification"), keys.indexOf("mobile") + 1))
      .toEqual(["notification", "postSendActions", "mobile"]);
  });

  it("uses the same state header and help placement for post-send actions", async () => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Post-send actions"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe("Disabled: Post-send actions");
    expect(editor.shadowRoot!.querySelector(".card-header .nc-help")).not.toBeNull();
    const toggle = editor.shadowRoot!.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe("Enabled: Post-send actions");
    expect(editor.shadowRoot!.querySelector("ha-form")).not.toBeNull();
  });

  it.each([
    { width: 1100, minimum: 420 },
    { width: 390, minimum: 320 },
  ])("gives late-loaded code editors a $minimum px minimum at width $width without capping growth", async ({ width, minimum }) => {
    const { editor } = await mount();
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    const form = editor.shadowRoot!.querySelector("ha-form")!;
    const root = form.attachShadow({ mode: "open" });
    const code = document.createElement("ha-code-editor") as HTMLElement & {
      codemirror: { dom: HTMLElement; scrollDOM: HTMLElement };
    };
    const dom = document.createElement("div");
    const scrollDOM = document.createElement("div");
    code.codemirror = { dom, scrollDOM };
    code.append(dom, scrollDOM);
    root.append(code);
    form.append(document.createElement("span"));
    await vi.waitFor(() => expect(dom.style.minHeight).toBe(`${minimum}px`));
    expect(scrollDOM.style.minHeight).toBe(`${minimum - 40}px`);
    expect(dom.style.height).toBe("");
  });

  it("renders the Notification message as a multiline editing surface rather than a tall panel", async () => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.trim() === "Notification")!);
    await settleElement(editor);
    const form = editor.shadowRoot!.querySelector("ha-form")!;
    const root = form.attachShadow({ mode: "open" });
    const code = document.createElement("ha-code-editor") as HTMLElement & {
      codemirror: { dom: HTMLElement; scrollDOM: HTMLElement; contentDOM: HTMLElement };
    };
    const dom = document.createElement("div");
    const scrollDOM = document.createElement("div");
    const contentDOM = document.createElement("div");
    const gutter = document.createElement("div");
    gutter.className = "cm-gutters";
    dom.append(gutter);
    contentDOM.contentEditable = "true";
    code.codemirror = { dom, scrollDOM, contentDOM };
    code.append(dom, scrollDOM, contentDOM);
    root.append(code);
    form.append(document.createElement("span"));
    await vi.waitFor(() => expect(dom.style.minHeight).toBe("320px"));
    expect(scrollDOM.style.minHeight).toBe("280px");
    expect(contentDOM.style.minHeight).toBe(scrollDOM.style.minHeight);
    expect(gutter.style.minHeight).toBe("280px");
    expect(scrollDOM.style.backgroundColor).toBe("var(--secondary-background-color)");
    expect(dom.style.height).toBe("");
  });

  it("opens section help with a Description explanation and closes it", async () => {
    const { editor } = await mount();
    const help = editor.shadowRoot!.querySelector('ha-icon-button[title="More information: Basic"]')!;
    await testUser().click(help);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-dialog")!.textContent).toContain("not included in notifications");
    expect(editor.shadowRoot!.querySelector("ha-dialog")!.getAttribute("width")).toBe("medium");
    expect(editor.shadowRoot!.querySelector(".nc-help-topic h3")!.textContent).toBe("Description");
    await testUser().click(editor.shadowRoot!.querySelector("ha-dialog ha-button")!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-dialog")).toBeNull();
    const form = editor.shadowRoot!.querySelector("ha-form") as HTMLElement & { computeHelper: (field: { name: string }) => string };
    expect(form.computeHelper({ name: "description" })).toContain("optional note");
  });

  it("shows an accessible help icon next to optional setting titles", async () => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Mobile options"))!);
    await settleElement(editor);
    await testUser().click(editor.shadowRoot!.querySelector('ha-icon-button[title="More information: Notification color"]')!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-dialog")!.textContent).toContain("#03A9F4");
    expect(editor.shadowRoot!.querySelectorAll(".nc-help-topic")).toHaveLength(1);
    expect(editor.shadowRoot!.querySelector(".nc-help-topic h3")).toBeNull();
  });

  it("separates multi-topic section help into labeled paragraphs", async () => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Mobile options"))!);
    await settleElement(editor);
    await testUser().click(editor.shadowRoot!.querySelector('ha-icon-button[title="More information: Mobile options"]')!);
    await settleElement(editor);
    expect([...editor.shadowRoot!.querySelectorAll(".nc-help-topic h3")].map(heading => heading.textContent))
      .toEqual(["Notification group", "Notification tag", "Notification color", "Notification icon", "Icon image URL"]);
    expect(editor.shadowRoot!.querySelectorAll(".nc-help-topic p")).toHaveLength(5);
  });

  it("shows a color picker only when enabled", async () => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Mobile options"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('input[type="color"]')).toBeNull();
    const toggle = editor.shadowRoot!.querySelector('[aria-label="Enable Notification color"]') as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    const picker = editor.shadowRoot!.querySelector('input[type="color"]') as HTMLInputElement;
    picker.value = "#ff0000";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    const colorForm = [...editor.shadowRoot!.querySelectorAll("ha-form")].find(form =>
      (form as HTMLElement & { schema: { name: string }[] }).schema[0].name === "color") as HTMLElement & { data: Record<string, unknown> };
    expect(colorForm.data.color).toBe("#ff0000");
    const off = editor.shadowRoot!.querySelector('[aria-label="Disable Notification color"]') as HTMLElement & { checked: boolean };
    off.checked = false;
    off.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('input[type="color"]')).toBeNull();
  });

  it.each([
    { key: "mobile", name: "color", value: "red" },
    { key: "android", name: "timeout", value: 0 },
    { key: "ios", name: "sound", value: { name: "default", critical: 1, volume: 0.8 } },
  ])("preserves disabled $name through save and reopen without sending it", ({ key, name, value }) => {
    const state: EditorState = {
      alert: editableAlert(draftAlertFixture()), hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    const section = editorSections.find(section => section.key === key)!;
    section.write(state, { [name]: value });
    expect(section.optional!.enabled(state, name)).toBe(true);
    section.optional!.set(state, name, false);
    const saved = finalizeAlert(state.alert, false, false);
    state.alert = editableAlert(saved);
    expect(section.read(state)[name]).toBeUndefined();
    expect(section.optional!.enabled(state, name)).toBe(false);
    expect(saved.notification.editor_options!.fields![`${key}.${name}`]).toEqual({ enabled: false, value });
    section.optional!.set(state, name, true);
    expect(section.read(state)[name]).toEqual(value);
  });

  it.each(["android", "ios"])("preserves a disabled %s section after reopening", key => {
    const state: EditorState = {
      alert: editableAlert(draftAlertFixture()), hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    const section = editorSections.find(section => section.key === key)!;
    const values = key === "android" ? { channel: "Security", sticky: false } : { sound: "default", badge: 0 };
    section.write(state, values);
    section.toggle!.set(state, false);
    state.alert = editableAlert(finalizeAlert(state.alert, false, false));
    expect(section.toggle!.get(state)).toBe(false);
    section.toggle!.set(state, true);
    expect(section.read(state)).toMatchObject(values);
  });

  it.each(["Android", "iOS / macOS"])("shows optional %s controls only when its switch is enabled", async title => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes(title))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-form")).toBeNull();
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe(`Disabled: ${title}`);
    expect(editor.shadowRoot!.querySelector(".card-header ha-switch")).not.toBeNull();
    const toggle = editor.shadowRoot!.querySelector("ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(".nc-option")).not.toBeNull();
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe(`Enabled: ${title}`);
    expect([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes(title))!.querySelector("ha-svg-icon")?.getAttribute("aria-label")).toBe("Enabled");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-form")).toBeNull();
  });

  it("saves a message-only notification with both platform sections disabled", () => {
    const alert = editableAlert(draftAlertFixture());
    alert.name = "Door";
    alert.notification.target = { device_id: ["phone"] };
    const state: EditorState = {
      alert, hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    editorSections.find(section => section.key === "notification")!.write(state, { message: "Door open" });
    for (const key of ["android", "ios"]) {
      const section = editorSections.find(section => section.key === key)!;
      expect(section.toggle!.get(state)).toBe(false);
      section.toggle!.set(state, true);
      section.toggle!.set(state, false);
    }
    expect(finalizeAlert(alert, false).notification.data).toEqual({ title: "", message: "Door open" });
  });

  it.each(["android", "ios"])("disables only managed %s options and restores them within the editor", key => {
    const alert = editableAlert(draftAlertFixture());
    alert.notification.data = {
      message: "Door open", group: "doors", sticky: false, channel: "Security",
      push: { sound: "default", badge: 0, custom: "keep" }, custom: 42,
    };
    const original = structuredClone(alert.notification.data);
    const state: EditorState = {
      alert, hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    const section = editorSections.find(section => section.key === key)!;
    expect(section.toggle!.get(state)).toBe(true);
    section.toggle!.set(state, false);
    expect(section.toggle!.get(state)).toBe(false);
    expect(alert.notification.data).toEqual(key === "android"
      ? { message: "Door open", group: "doors", push: original.push, custom: 42 }
      : { message: "Door open", group: "doors", sticky: false, channel: "Security", push: { custom: "keep" }, custom: 42 });
    section.toggle!.set(state, true);
    expect(alert.notification.data).toEqual(original);
  });

  it("keeps mobile settings in native data and preserves unknown options", () => {
    const alert = editableAlert(draftAlertFixture());
    alert.name = "Door alert";
    alert.notification.target = { device_id: ["phone"] };
    alert.notification.data = { title: "Door", message: "Open", custom: "keep", push: { custom: 42 } };
    const state: EditorState = {
      alert, hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    editorSections.find(section => section.key === "mobile")!.write(state, { group: "doors", tag: "door", color: "#FF0000" });
    editorSections.find(section => section.key === "android")!.write(state, { channel: "Security", importance: "high", persistent: true, sticky: true });
    editorSections.find(section => section.key === "ios")!.write(state, { "interruption-level": "time-sensitive", sound: "default", badge: 0 });
    expect(alert.notification.data).toEqual({
      title: "Door", message: "Open",
      custom: "keep", group: "doors", tag: "door", color: "#FF0000",
      channel: "Security", importance: "high", persistent: true, sticky: true,
      push: { custom: 42, "interruption-level": "time-sensitive", sound: "default", badge: 0 },
    });
    editorSections.find(section => section.key === "ios")!.write(state, { sound: "" });
    expect(alert.notification.data.push).toEqual({ custom: 42, "interruption-level": "time-sensitive", badge: 0 });
    editorSections.find(section => section.key === "mobile")!.write(state, { tag: "" });
    expect(finalizeAlert(alert, false).notification.data).toMatchObject({ persistent: true, title: "Door", message: "Open" });
  });

  it("preserves structured iOS critical sounds when changing another option", () => {
    const alert = editableAlert(draftAlertFixture());
    const sound = { name: "default", critical: 1, volume: 0.8 };
    alert.notification.data = { push: { sound } };
    const state: EditorState = {
      alert, hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    const section = editorSections.find(section => section.key === "ios")!;
    expect(section.schema(state).find(field => field.name === "sound")!.selector).toEqual({ object: {} });
    section.write(state, { ...section.read(state), subtitle: "Door" });
    expect(alert.notification.data.push).toEqual({ sound });
  });

  it.each([
    { platforms: ["android"], unknown: false, label: "Android" },
    { platforms: ["ios"], unknown: false, label: "iOS / macOS" },
    { platforms: ["android", "ios"], unknown: true, label: "Android, iOS / macOS, Unknown" },
  ])("shows detected recipient platforms: $label", async ({ platforms, unknown, label }) => {
    const sendMessagePromise = vi.fn().mockResolvedValue({ platforms, unknown });
    const { editor } = await mount(undefined, sendMessagePromise);
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Recipients"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('[role="status"]')).toBeNull();
    for (const platform of platforms) {
      const title = platform === "android" ? "Android" : "iOS / macOS";
      expect(editor.shadowRoot!.textContent).toContain(`${title} (recipients selected)`);
    }
    expect(sendMessagePromise).toHaveBeenCalledWith({ type: "ha_notifications/mobile_platforms", target: {} });
    const form = editor.shadowRoot!.querySelector("ha-form")!;
    form.dispatchEvent(new CustomEvent("value-changed", { detail: { value: { target: { device_id: ["phone"] } } } }));
    await settleElement(editor);
    expect(sendMessagePromise).toHaveBeenLastCalledWith({ type: "ha_notifications/mobile_platforms", target: { device_id: ["phone"] } });
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Mobile options"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe(label);
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Android"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps both platform sections available when detection fails", async () => {
    const { editor } = await mount(undefined, vi.fn().mockRejectedValue(new Error("Offline")));
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Mobile options"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe("Unknown");
    expect(editor.shadowRoot!.textContent).toContain("Android");
    expect(editor.shadowRoot!.textContent).toContain("iOS / macOS");
  });

  it.each([undefined, ["existing-user"]])("omits the Users picker and preserves stored user targets: %j", users => {
    const alert = editableAlert(draftAlertFixture());
    alert.notification.target = { area_id: ["kitchen"], ...(users ? { user_id: users } : {}) };
    const state: EditorState = {
      alert,
      hass: homeAssistantFixture(),
      localize: () => "",
      postConfirmationActions: false,
      users: [],
    };
    const section = editorSections.find(section => section.key === "recipients")!;
    expect(section.schema(state).map(field => field.name)).toEqual(["target"]);
    expect(section.read(state)).toEqual({ target: { area_id: ["kitchen"] } });
    section.write(state, { target: { entity_id: ["notify.phone"] } });
    expect(alert.notification.target).toEqual({
      entity_id: ["notify.phone"], ...(users ? { user_id: users } : {}),
    });
  });

  it("insets expanded native fields without adding padding to collapsed rows", async () => {
    const { editor } = await mount();
    const form = editor.shadowRoot!.querySelector("ha-form")!;
    const panel = document.createElement("ha-expansion-panel");
    form.attachShadow({ mode: "open" }).append(panel);
    const toggle = (expanded: boolean) => panel.dispatchEvent(new CustomEvent("expanded-will-change", {
      detail: { expanded },
      bubbles: true,
      composed: true,
    }));

    toggle(true);
    expect(panel.style.getPropertyValue("--expansion-panel-content-padding")).toBe("var(--ha-space-6, 24px) var(--ha-space-4, 16px)");
    const nestedPanel = document.createElement("ha-expansion-panel");
    panel.attachShadow({ mode: "open" }).append(nestedPanel);
    nestedPanel.dispatchEvent(new CustomEvent("expanded-will-change", {
      detail: { expanded: true },
      bubbles: true,
      composed: true,
    }));
    expect(nestedPanel.style.getPropertyValue("--expansion-panel-content-padding")).toBe("");
    expect(panel.style.getPropertyValue("--expansion-panel-content-padding")).toBe("var(--ha-space-6, 24px) var(--ha-space-4, 16px)");
    toggle(false);
    expect(panel.style.getPropertyValue("--expansion-panel-content-padding")).toBe("0");
  });

  it("loads HA configuration translations when opened", async () => {
    const loadFragmentTranslation = vi.fn().mockResolvedValue(undefined);
    await mount(loadFragmentTranslation);
    expect(loadFragmentTranslation).toHaveBeenCalledExactlyOnceWith("config");
  });

  it("reports translation-loading errors through HA's snackbar", async () => {
    const notifications: CustomEvent[] = [];
    const listener = (event: Event) => notifications.push(event as CustomEvent);
    document.body.addEventListener("hass-notification", listener);
    try {
      await mount(vi.fn().mockRejectedValue(new Error("Translation unavailable")));
      expect(notifications).toHaveLength(1);
      expect(notifications[0].detail.message).toBe("Translation unavailable");
    } finally {
      document.body.removeEventListener("hass-notification", listener);
    }
  });

  it("passes responsive mode to the trigger form without changing alert data", async () => {
    const { editor, alert } = await mount();
    const original = structuredClone(alert);
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Triggers"))!);
    await settleElement(editor);
    const form = editor.shadowRoot!.querySelector("ha-form") as HTMLElement & {
      narrow: boolean;
      schema: { name: string; selector: object }[];
    };
    expect(form.schema).toContainEqual({ name: "triggers", selector: { trigger: {} } });
    expect(form.narrow).toBe(false);
    resize([{ contentRect: { width: 390 } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    expect(form.narrow).toBe(true);
    expect(alert).toEqual(original);
  });
});