// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { parse, stringify } from "yaml";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(
  loadFragmentTranslation = vi.fn().mockResolvedValue(undefined),
  sendMessagePromise = vi.fn().mockResolvedValue({ platforms: [], unknown: true }),
  alert = draftAlertFixture(),
) {
  const root = editorRoot();
  const onSave = vi.fn().mockResolvedValue(undefined);
  openEditor({
    root,
    hass: homeAssistantFixture({ loadFragmentTranslation, connection: { sendMessagePromise } as never }),
    alert,
    users: [],
    onSave,
    onValidateAlert: vi.fn(),
  });
  const editor = root.querySelector<LitElement>("ha-notifications-alert-editor")!;
  await settleElement(editor);
  return { editor, alert, onSave };
}

type NativeForm = HTMLElement & {
  schema: { name: string; selector: Record<string, unknown>; disabled?: boolean }[];
  data: Record<string, unknown>;
  computeLabel: (field: { name: string }) => string;
};

function nativeForm(editor: LitElement, name: string): NativeForm {
  const forms = [...editor.shadowRoot!.querySelectorAll<NativeForm>("ha-form")]
    .filter(form => form.schema.some(field => field.name === name));
  expect(forms).toHaveLength(1);
  return forms[0];
}

async function selectSection(editor: LitElement, key: string): Promise<void> {
  const state = (editor as unknown as { state: EditorState }).state;
  const section = editorSections.find(section => section.key === key)!;
  const dropdown = editor.shadowRoot!.querySelector(".nc-nav-dropdown");
  if (dropdown) {
    dropdown.dispatchEvent(new CustomEvent("wa-select", { detail: { item: { value: key } } }));
  } else {
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.trim() === state.localize(section.title))!);
  }
  await settleElement(editor);
}

async function changeField(editor: LitElement, name: string, value: unknown): Promise<void> {
  nativeForm(editor, name).dispatchEvent(new CustomEvent("value-changed", {
    detail: { value: { [name]: value } },
  }));
  await settleElement(editor);
}

describe("native editor controls", () => {
  it("keeps message content out of Android options", () => {
    const state: EditorState = {
      alert: editableAlert(draftAlertFixture()),
      hass: homeAssistantFixture(),
      localize: () => "",
      postConfirmationActions: false,
      users: [],
    };
    state.alert.notification.data.message = "Door opened";
    state.alert.notification.data.subject = "Native YAML value";
    const section = editorSections.find(item => item.key === "android")!;
    const fields = section.schema(state).map(item => item.name);
    expect(fields).not.toContain("subject");
    expect(fields).not.toContain("message");
    expect(fields).not.toContain("title");
    section.write(state, { channel: "Security", persistent: true });
    expect(state.alert.notification.data.message).toBe("Door opened");
    expect(finalizeAlert(state.alert, false, false).notification.data.subject).toBe("Native YAML value");
  });

  it.each([1100, 390])("applies declared field widths without leaking layout metadata at viewport %s", async viewport => {
    const { editor } = await mount();
    resize([{ contentRect: { width: viewport } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    const state = (editor as unknown as { state: EditorState }).state;
    const layouts: Record<string, unknown> = {};
    const cases = [
      { key: "basic", values: {}, widths: { icon: "compact" } },
      { key: "when", values: {}, widths: { automation_mode: "compact" } },
      { key: "mobile", values: { group: "doors", notification_icon: "mdi:door", icon_url: "https://example.com/icon.png" }, widths: { group: "medium", notification_icon: "compact" } },
      { key: "android", values: { channel: "Security", importance: "high", visibility: "private", timeout: 0 }, widths: { channel: "medium", importance: "compact", visibility: "compact", timeout: "compact" } },
      { key: "ios", values: { "interruption-level": "time-sensitive", badge: 0, presentation_options: ["alert", "sound"], url: "https://example.com" }, widths: { "interruption-level": "compact", badge: "compact", presentation_options: "compact" } },
    ];
    for (const { key, values, widths } of cases) {
      editorSections.find(section => section.key === key)!.write(state, values);
      await selectSection(editor, key);
      const forms = [...editor.shadowRoot!.querySelectorAll<NativeForm>("ha-form")];
      for (const form of forms) {
        expect(form.schema.every(field => !("width" in field))).toBe(true);
        expect(form.schema).toHaveLength(1);
        const width = (widths as Record<string, string>)[form.schema[0].name];
        expect(form.className).toBe(width ? `nc-${width}-form` : "");
        expect((form as NativeForm & { narrow: boolean }).narrow).toBe(viewport < 870);
      }
      layouts[key] = forms.map(form => ({
        class: form.className,
        schema: form.schema,
        label: form.computeLabel(form.schema[0]),
      }));
    }
    expect(layouts).toMatchSnapshot();
    const styles = (editor.constructor as typeof LitElement).styles!.toString();
    expect(styles).toMatch(/ha-form\.nc-compact-form\s*\{\s*width: 100%;\s*max-width: 360px;/);
    expect(styles).toMatch(/ha-form\.nc-medium-form\s*\{\s*width: 100%;\s*max-width: 400px;/);
  });

  it.each([
    { key: "basic", name: "description", values: {} },
    { key: "mobile", name: "icon_url", values: { icon_url: "https://example.com/icon.png" } },
    { key: "android", name: "clickAction", values: { clickAction: "https://example.com" } },
    { key: "ios", name: "url", values: { url: "https://example.com" } },
    { key: "ios", name: "sound", values: { sound: { name: "default", critical: 1, volume: 0.8 } } },
    { key: "notification", name: "message", values: {} },
    { key: "confirmationNotification", name: "message", values: {} },
    { key: "triggers", name: "triggers", values: {} },
    { key: "postSendActions", name: "actions", values: {} },
    { key: "postConfirmationActions", name: "actions", values: {} },
    { key: "recipients", name: "target", values: {} },
  ])("keeps $key.$name full-width", async ({ key, name, values }) => {
    const { editor } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    if (Object.keys(values).length) editorSections.find(section => section.key === key)!.write(state, values);
    await selectSection(editor, key);
    expect(nativeForm(editor, name).className).toBe("");
    expect(nativeForm(editor, name).schema.every(field => !("width" in field))).toBe(true);
  });

  it("merges split Basic updates and changes mode without resetting sibling configuration", async () => {
    const { editor } = await mount(undefined, undefined, draftAlertFixture({
      name: "Door", description: "Front door alert", icon: "mdi:door",
    }));
    const state = (editor as unknown as { state: EditorState }).state;
    await changeField(editor, "icon", "mdi:door-open");
    expect(state.alert).toMatchObject({ name: "Door", description: "Front door alert", icon: "mdi:door-open" });
    await changeField(editor, "name", "Front door");
    await changeField(editor, "description", "Updated note");
    expect(state.alert).toMatchObject({ name: "Front door", description: "Updated note", icon: "mdi:door-open" });
    const monitor = structuredClone(state.alert.monitor);
    await selectSection(editor, "when");
    const mode = nativeForm(editor, "automation_mode");
    const schema = mode.schema;
    await changeField(editor, "automation_mode", "queued");
    expect(mode.schema).toBe(schema);
    expect(state.alert.monitor).toEqual({ ...monitor, automation_mode: "queued" });
    expect(state.alert).toMatchObject({ name: "Front door", description: "Updated note", icon: "mdi:door-open" });
  });

  it("writes only the changed optional field and preserves mobile siblings and boolean label rows", async () => {
    const { editor } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.notification.data = {
      message: "Door open", channel: "Security", importance: "high", persistent: false,
      push: { sound: { name: "default", critical: 1, volume: 0.8 } }, custom: "keep",
    };
    await selectSection(editor, "android");
    const section = editorSections.find(section => section.key === "android")!;
    const write = vi.spyOn(section, "write");
    const original = structuredClone(state.alert.notification.data);
    await changeField(editor, "importance", "low");
    expect(write).toHaveBeenLastCalledWith(state, { importance: "low" });
    expect(state.alert.notification.data).toEqual({ ...original, importance: "low" });
    const persistent = nativeForm(editor, "persistent");
    expect(persistent.className).toBe("");
    expect(persistent.closest(".nc-option")).toBeNull();
    expect(persistent.computeLabel(persistent.schema[0])).toBe("Persistent notification");
    await changeField(editor, "persistent", true);
    expect(write).toHaveBeenLastCalledWith(state, { persistent: true });
    expect(state.alert.notification.data).toEqual({ ...original, importance: "low", persistent: true });
  });

  it("shows only automation mode under When to run and preserves its native control", async () => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.trim() === "When to run")!);
    await settleElement(editor);
    const form = editor.shadowRoot!.querySelector("ha-form") as HTMLElement & {
      schema: { name: string; selector: unknown }[];
      data: Record<string, unknown>;
    };
    expect(form.schema.map(field => field.name)).toEqual(["automation_mode"]);
    expect(form.schema).toMatchSnapshot();
    expect(form.data).toEqual({ automation_mode: "parallel" });
    form.dispatchEvent(new CustomEvent("value-changed", {
      detail: { value: { automation_mode: "queued" } },
    }));
    await settleElement(editor);
    const state = (editor as unknown as { state: EditorState }).state;
    expect(state.alert.monitor.automation_mode).toBe("queued");
  });

  it("keeps conditional automation mode locked to parallel without changing the stored mode", () => {
    const state: EditorState = {
      alert: editableAlert(draftAlertFixture()),
      hass: homeAssistantFixture(),
      localize: () => "",
      postConfirmationActions: false,
      users: [],
    };
    state.alert.monitor.automation_mode = "queued";
    state.alert.monitor.conditions.items = [{ condition: "template", value_template: "{{ true }}" }];
    const section = editorSections.find(section => section.key === "when")!;
    expect(section.schema(state)).toMatchObject([{ name: "automation_mode", disabled: true }]);
    expect(section.read(state)).toEqual({ automation_mode: "parallel" });
    section.write(state, { automation_mode: "restart" });
    expect(state.alert.monitor.automation_mode).toBe("queued");
  });

  it.each([true, false])("preserves native inactive controls through enablement, save and YAML with clear notification %s", async clearNotification => {
    const { editor } = await mount();
    expect(editorSections.find(section => section.key === "inactive")!.parent).toBe("when");
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.trim() === "Inactive")!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe("Inactive");
    const toggle = editor.shadowRoot!.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    const form = editor.shadowRoot!.querySelector("ha-form") as HTMLElement & {
      schema: { name: string; selector: unknown; disabled?: boolean }[];
      data: Record<string, unknown>;
      computeLabel: (field: { name: string }) => string;
      computeHelper: (field: { name: string }) => string;
    };
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute("aria-label")).toBe("Enable Inactive");
    expect(form.schema.every(field => field.disabled)).toBe(true);
    expect(form.data).toEqual({ triggers: [], clear_notification: false });
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(form.schema).toMatchSnapshot();
    expect(form.computeLabel({ name: "clear_notification" })).toBe("Clear notification");
    expect(form.computeHelper({ name: "clear_notification" })).toContain("inactive trigger fires");
    const schema = form.schema;
    const triggers = [{ trigger: "event", event_type: "door_closed", event_data: { door: "front" }, id: "closed", alias: "Closed", enabled: false, custom: { keep: true } }];
    form.dispatchEvent(new CustomEvent("value-changed", {
      detail: { value: { triggers, clear_notification: clearNotification } },
    }));
    await settleElement(editor);
    expect(form.schema).toBe(schema);
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.name = "Door";
    state.alert.notification.target = { entity_id: ["notify.phone"] };
    for (const enabled of [true, false, true]) {
      toggle.checked = enabled;
      toggle.dispatchEvent(new Event("change"));
      await settleElement(editor);
      expect(form.schema.every(field => Boolean(field.disabled) === !enabled)).toBe(true);
      expect(state.alert.enabled).toBe(true);
      expect(state.alert.monitor.triggers.items).toEqual([]);
      for (const validate of [true, false]) {
        const saved = finalizeAlert(state.alert, false, validate);
        const yaml = parse(stringify(saved));
        expect(yaml.monitor).toEqual(saved.monitor);
        expect(saved.monitor.inactive).toEqual({ enabled, items: triggers, clear_notification: clearNotification });
        expect(editableAlert(saved).monitor.inactive).toEqual(saved.monitor.inactive);
      }
    }
    await testUser().click(editor.shadowRoot!.querySelector('ha-icon-button[title="More information: Inactive"]')!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-dialog")!.textContent).toContain("cancel pending confirmation waits");
  });

  it("groups mobile settings independently and keeps post-send actions under Notification", () => {
    expect(editorSections.find(section => section.key === "mobile")!.parent).toBeUndefined();
    expect(editorSections.find(section => section.key === "android")!.parent).toBe("mobile");
    expect(editorSections.find(section => section.key === "ios")!.parent).toBe("mobile");
    expect(editorSections.find(section => section.key === "postSendActions")!.parent).toBe("notification");
    const keys = editorSections.map(section => section.key);
    expect(keys.slice(keys.indexOf("notification"), keys.indexOf("mobile") + 1))
      .toEqual(["notification", "postSendActions", "mobile"]);
  });

  it("does not expose the generic notification tag as a mobile option", () => {
    const state: EditorState = {
      alert: editableAlert(draftAlertFixture()),
      hass: homeAssistantFixture(),
      localize: () => "",
      postConfirmationActions: false,
      users: [],
    };
    expect(editorSections.find(section => section.key === "mobile")!.schema(state).map(field => field.name))
      .not.toContain("tag");
  });

  it("uses the same state header and help placement for post-send actions", async () => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Post-send actions"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe("Post-send actions");
    expect(editor.shadowRoot!.querySelector(".card-header .nc-help")).not.toBeNull();
    const titleRow = editor.shadowRoot!.querySelector(".nc-title-row")!;
    expect(titleRow.children[0].tagName).toBe("H2");
    expect(titleRow.children[1]).toBe(editor.shadowRoot!.querySelector(".card-header .nc-help"));
    const disabledForm = editor.shadowRoot!.querySelector("ha-form") as HTMLElement & { schema: { disabled?: boolean }[] };
    expect(disabledForm).not.toBeNull();
    expect(disabledForm.schema[0].disabled).toBe(true);
    const toggle = editor.shadowRoot!.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe("Post-send actions");
    expect((editor.shadowRoot!.querySelector("ha-form") as HTMLElement & { schema: { disabled?: boolean }[] }).schema[0].disabled).toBeUndefined();
  });

  it("keeps Triggers, Conditions and global alert enablement independent", async () => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.trim() === "When to run")!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe("When to run");
    expect(editor.shadowRoot!.querySelector(".card-header ha-switch")).toBeNull();

    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.trim() === "Triggers")!);
    await settleElement(editor);
    const triggerToggle = editor.shadowRoot!.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    expect(triggerToggle.checked).toBe(true);
    expect(triggerToggle.getAttribute("aria-label")).toBe("Disable Triggers");
    triggerToggle.checked = false;
    triggerToggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(triggerToggle.checked).toBe(false);
    expect(editor.shadowRoot!.querySelector("ha-form")).not.toBeNull();
    expect((editor.shadowRoot!.querySelector("ha-form") as HTMLElement & { schema: { disabled?: boolean }[] }).schema[0].disabled).toBe(true);

    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.trim() === "Conditions")!);
    await settleElement(editor);
    const conditionToggle = editor.shadowRoot!.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    expect(conditionToggle.checked).toBe(true);
    expect(conditionToggle.getAttribute("aria-label")).toBe("Disable Conditions");
    expect((editor as unknown as { state: EditorState }).state.alert.enabled).toBe(true);
    conditionToggle.checked = false;
    conditionToggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(conditionToggle.checked).toBe(false);
    expect((editor as unknown as { state: EditorState }).state.alert.enabled).toBe(true);

    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.trim() === "Triggers")!);
    await settleElement(editor);
    expect((editor.shadowRoot!.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean }).checked).toBe(false);
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
    expect(scrollDOM.style.backgroundColor).toBe("");
    expect(dom.style.height).toBe("");
  });

  it("preserves the native theme in Notify recipients when confirmed", async () => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.trim() === "Notify recipients when confirmed")!);
    await settleElement(editor);
    const form = editor.shadowRoot!.querySelector("ha-form")!;
    const root = form.attachShadow({ mode: "open" });
    const code = document.createElement("ha-code-editor") as HTMLElement & {
      codemirror: { dom: HTMLElement; scrollDOM: HTMLElement };
    };
    const dom = document.createElement("div");
    const scrollDOM = document.createElement("div");
    scrollDOM.style.backgroundColor = "rgb(24, 28, 32)";
    code.codemirror = { dom, scrollDOM };
    code.append(dom, scrollDOM);
    root.append(code);
    form.append(document.createElement("span"));
    await vi.waitFor(() => expect(dom.style.minHeight).not.toBe(""));
    expect(scrollDOM.style.backgroundColor).toBe("rgb(24, 28, 32)");
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
      .toEqual(["Notification group", "Notification color", "Notification icon", "Icon image URL"]);
    expect(editor.shadowRoot!.querySelectorAll(".nc-help-topic p")).toHaveLength(4);
  });

  it("shows a color picker only when enabled", async () => {
    const { editor } = await mount();
    editor.style.setProperty("--primary-color", "#03a9f4");
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Mobile options"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('input[type="color"]')).toBeNull();
    const toggle = editor.shadowRoot!.querySelector('[aria-label="Enable Notification color"]') as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    const picker = editor.shadowRoot!.querySelector('input[type="color"]') as HTMLInputElement;
    expect(picker.value).toBe("#03a9f4");
    expect((editor as unknown as { state: EditorState }).state.alert.notification.data.color).toBe("#03a9f4");
    picker.value = "#ff0000";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(".nc-option-input ha-form")).toBeNull();
    expect(picker.value).toBe("#ff0000");
    expect((editor as unknown as { state: EditorState }).state.alert.notification.data.color).toBe("#ff0000");
    expect((editor as unknown as { state: EditorState }).state.alert.notification.data.color).toBe("#ff0000");
    const off = editor.shadowRoot!.querySelector('[aria-label="Disable Notification color"]') as HTMLElement & { checked: boolean };
    off.checked = false;
    off.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('input[type="color"]')).toBeNull();
  });

  it.each([true, false])("saves and reopens Android persistent=%s, LED color and zero timeout from native controls", async persistent => {
    const { editor, onSave } = await mount();
    editor.style.setProperty("--primary-color", "#03a9f4");
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.name = "Door";
    state.alert.notification.target = { entity_id: ["notify.phone"] };
    await selectSection(editor, "android");
    const toggle = editor.shadowRoot!.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);

    expect(nativeForm(editor, "persistent").schema).toEqual([{ name: "persistent", selector: { boolean: {} } }]);
    await changeField(editor, "persistent", persistent);
    for (const name of ["ledColor", "timeout"]) {
      const section = editorSections.find(section => section.key === "android")!;
      const label = state.localize(section.labels[name]);
      const option = editor.shadowRoot!.querySelector(`[aria-label="Enable ${label}"]`) as HTMLElement & { checked: boolean };
      option.checked = true;
      option.dispatchEvent(new Event("change"));
      await settleElement(editor);
    }
    const picker = editor.shadowRoot!.querySelector('input[type="color"]') as HTMLInputElement;
    expect(picker).not.toBeNull();
    expect(picker.getAttribute("aria-label")).toContain("Channel LED color");
    picker.value = "#12ab34";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect([...editor.shadowRoot!.querySelectorAll<NativeForm>("ha-form")]
      .some(form => form.schema.some(field => field.name === "ledColor"))).toBe(false);
    expect(picker.closest(".nc-option-input")!.querySelector("ha-form")).toBeNull();
    await changeField(editor, "timeout", 0);
    expect(nativeForm(editor, "timeout").classList.contains("nc-compact-form")).toBe(true);
    expect(state.alert.notification.data).toMatchObject({ persistent, ledColor: "#12ab34", timeout: 0 });

    const finalized = finalizeAlert(state.alert, false);
    await testUser().click([...editor.shadowRoot!.querySelectorAll("ha-button")]
      .find(button => button.textContent?.trim() === "Save alert")!);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0][0];
    expect(saved).toEqual(finalized);
    expect(parse(stringify(saved)).notification.data).toMatchObject({ persistent, ledColor: "#12ab34", timeout: 0 });

    const { editor: reopened } = await mount(undefined, undefined, saved);
    await selectSection(reopened, "android");
    expect((reopened.shadowRoot!.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean }).checked).toBe(true);
    expect(nativeForm(reopened, "persistent").data.persistent).toBe(persistent);
    expect(nativeForm(reopened, "timeout").data.timeout).toBe(0);
    expect((reopened.shadowRoot!.querySelector('input[type="color"]') as HTMLInputElement).value).toBe("#12ab34");
    expect([...reopened.shadowRoot!.querySelectorAll<NativeForm>("ha-form")]
      .some(form => form.schema.some(field => field.name === "ledColor"))).toBe(false);
  });

  it("keeps confirmation timeout compact and preserves sibling settings through field updates and hiding", async () => {
    const { editor } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    const buttons = [{ label: "Done", id: "done" }];
    state.alert.confirmation.enabled = true;
    Object.assign(state.alert.confirmation.reminders, {
      enabled: true, interval: { minutes: 7 }, max_attempts: 4, show_attempts: true,
    });
    await selectSection(editor, "confirmation");
    expect(nativeForm(editor, "buttons").schema.map(field => field.name)).toEqual(["buttons", "forget_after_enabled"]);
    expect([...editor.shadowRoot!.querySelectorAll<NativeForm>("ha-form")]
      .some(form => form.schema.some(field => field.name === "timeout"))).toBe(false);
    nativeForm(editor, "forget_after_enabled").dispatchEvent(new CustomEvent("value-changed", {
      detail: { value: { buttons, forget_after_enabled: true } },
    }));
    await settleElement(editor);

    const timeout = nativeForm(editor, "timeout");
    expect(timeout.schema).toEqual([{ name: "timeout", selector: { duration: { enable_day: true } } }]);
    expect(timeout.computeLabel({ name: "timeout" })).toBe("Confirmation timeout");
    expect(timeout.classList.contains("nc-compact-form")).toBe(true);
    expect(nativeForm(editor, "buttons").schema.map(field => field.name)).toEqual(["buttons"]);
    expect(nativeForm(editor, "buttons").classList.contains("nc-compact-form")).toBe(false);
    await changeField(editor, "timeout", { minutes: 12 });
    expect(state.alert.confirmation).toMatchObject({
      enabled: true, buttons,
      reminders: { enabled: true, forget_after_enabled: true, timeout: { minutes: 12 }, interval: { minutes: 7 }, max_attempts: 4, show_attempts: true },
    });
    const updatedButtons = [{ label: "Confirmed", id: "confirmed" }];
    await changeField(editor, "buttons", updatedButtons);
    expect(state.alert.confirmation.reminders.forget_after_enabled).toBe(true);
    expect(nativeForm(editor, "timeout").data.timeout).toEqual({ days: 0, hours: 0, minutes: 12, seconds: 0 });
    await changeField(editor, "forget_after_enabled", false);
    expect([...editor.shadowRoot!.querySelectorAll<NativeForm>("ha-form")]
      .some(form => form.schema.some(field => field.name === "timeout"))).toBe(false);
    expect(state.alert.confirmation.buttons).toEqual(updatedButtons);
    expect(state.alert.confirmation.reminders.timeout).toEqual({ days: 0, hours: 0, minutes: 12, seconds: 0 });

    const section = editorSections.find(section => section.key === "confirmation")!;
    section.write(state, { buttons: updatedButtons, forget_after_enabled: false });
    expect(state.alert.confirmation.reminders.timeout).toEqual({ days: 0, hours: 0, minutes: 12, seconds: 0 });
    await changeField(editor, "forget_after_enabled", true);
    expect(nativeForm(editor, "timeout").classList.contains("nc-compact-form")).toBe(true);
    expect(nativeForm(editor, "timeout").data.timeout).toEqual({ days: 0, hours: 0, minutes: 12, seconds: 0 });
  });

  it("renders Remind every as a compact duration and merges each reminder field without resetting siblings", async () => {
    const { editor } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.confirmation.enabled = true;
    state.alert.confirmation.buttons = [{ label: "Done", id: "done" }];
    Object.assign(state.alert.confirmation.reminders, {
      enabled: true, forget_after_enabled: true, timeout: { minutes: 12 },
      interval: { minutes: 7 }, max_attempts: 4, show_attempts: true,
    });
    await selectSection(editor, "reminder");
    const interval = nativeForm(editor, "interval");
    expect(interval.schema).toEqual([{ name: "interval", selector: { duration: { enable_day: true } } }]);
    expect(interval.computeLabel({ name: "interval" })).toBe("Remind every");
    expect(interval.classList.contains("nc-compact-form")).toBe(true);
    expect(nativeForm(editor, "max_attempts").classList.contains("nc-compact-form")).toBe(true);
    expect(nativeForm(editor, "show_attempts").classList.contains("nc-compact-form")).toBe(false);
    expect([...editor.shadowRoot!.querySelectorAll<NativeForm>("ha-form")]
      .map(form => form.schema.map(field => field.name))).toEqual([["interval"], ["max_attempts"], ["show_attempts"]]);
    await changeField(editor, "interval", { minutes: 3 });
    expect(state.alert.confirmation.reminders).toMatchObject({ enabled: true, max_attempts: 4, show_attempts: true });
    await changeField(editor, "max_attempts", 8);
    await changeField(editor, "show_attempts", false);
    expect(state.alert.confirmation).toMatchObject({
      enabled: true, buttons: [{ label: "Done", id: "done" }],
      reminders: {
        enabled: true, forget_after_enabled: true, timeout: { minutes: 12 },
        interval: { days: 0, hours: 0, minutes: 3, seconds: 0 }, max_attempts: 8, show_attempts: false,
      },
    });
    expect(parse(stringify(finalizeAlert(state.alert, false, false))).confirmation.reminders)
      .toMatchObject({ enabled: true, interval: 180, timeout: 720, max_attempts: 8, show_attempts: false });
  });

  it("shows the literal confirmed_by template and example in confirmation notification help", async () => {
    const { editor } = await mount();
    await selectSection(editor, "confirmationNotification");
    await testUser().click(editor.shadowRoot!.querySelector('ha-icon-button[title="More information: Notify recipients when confirmed"]')!);
    await settleElement(editor);
    const dialog = editor.shadowRoot!.querySelector("ha-dialog")!;
    expect(dialog.textContent).toContain("Use {{ confirmed_by }} for the recipient's name.");
    expect(dialog.textContent).toContain("Example: Confirmed by {{ confirmed_by }}.");
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
    const group = key === "mobile" ? "general" : key;
    expect(saved.mobile_options![group]!.fields![name]).toEqual({ enabled: false, value });
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
    expect(section.read(state)).toMatchObject(values);
    expect(state.alert.notification.data).not.toMatchObject(values);
    section.toggle!.set(state, true);
    expect(section.read(state)).toMatchObject(values);
  });

  it.each(["Android", "iOS / macOS"])("shows optional %s controls only when its switch is enabled", async title => {
    const { editor } = await mount();
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes(title))!);
    await settleElement(editor);
    const disabledOption = editor.shadowRoot!.querySelector(".nc-option ha-switch") as HTMLElement & { disabled: boolean };
    expect(disabledOption).not.toBeNull();
    expect(disabledOption.disabled).toBe(true);
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe(title);
    expect(editor.shadowRoot!.querySelector(".card-header ha-switch")).not.toBeNull();
    const toggle = editor.shadowRoot!.querySelector("ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(".nc-option")).not.toBeNull();
    expect((editor.shadowRoot!.querySelector(".nc-option ha-switch") as HTMLElement & { disabled: boolean }).disabled).toBe(false);
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe(title);
    expect([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes(title))!.querySelector("ha-svg-icon")?.getAttribute("aria-label")).toBe("Enabled");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect((editor.shadowRoot!.querySelector(".nc-option ha-switch") as HTMLElement & { disabled: boolean }).disabled).toBe(true);
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
    editorSections.find(section => section.key === "mobile")!.write(state, { group: "doors", color: "#FF0000" });
    editorSections.find(section => section.key === "android")!.write(state, { channel: "Security", importance: "high", persistent: true, sticky: true });
    editorSections.find(section => section.key === "ios")!.write(state, { "interruption-level": "time-sensitive", sound: "default", badge: 0 });
    expect(alert.notification.data).toEqual({
      title: "Door", message: "Open",
      custom: "keep", group: "doors", color: "#FF0000",
      channel: "Security", importance: "high", persistent: true, sticky: true,
      push: { custom: 42, "interruption-level": "time-sensitive", sound: "default", badge: 0 },
    });
    editorSections.find(section => section.key === "ios")!.write(state, { sound: "" });
    expect(alert.notification.data.push).toEqual({ custom: 42, "interruption-level": "time-sensitive", badge: 0 });
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
    expect(editor.shadowRoot!.querySelector('[role="status"]')?.textContent).toBe(label);
    expect(editor.shadowRoot!.textContent).not.toContain("Recipient platforms");
    for (const platform of platforms) {
      const title = platform === "android" ? "Android" : "iOS / macOS";
      expect([...editor.shadowRoot!.querySelectorAll("nav button")]
        .find(button => button.textContent?.trim() === title)).toBeDefined();
      expect(editor.shadowRoot!.textContent).not.toContain("recipients selected");
    }
    expect(sendMessagePromise).toHaveBeenCalledWith({ type: "ha_notifications/mobile_platforms", target: {} });
    const form = editor.shadowRoot!.querySelector("ha-form")!;
    form.dispatchEvent(new CustomEvent("value-changed", { detail: { value: { target: { device_id: ["phone"] } } } }));
    await settleElement(editor);
    expect(sendMessagePromise).toHaveBeenLastCalledWith({ type: "ha_notifications/mobile_platforms", target: { device_id: ["phone"] } });
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Mobile options"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('[role="status"]')).toBeNull();
    expect([...editor.shadowRoot!.querySelectorAll("nav button")]
      .some(button => button.textContent?.trim() === "Android")).toBe(platforms.includes("android"));
    expect([...editor.shadowRoot!.querySelectorAll("nav button")]
      .some(button => button.textContent?.trim() === "iOS / macOS")).toBe(platforms.includes("ios"));
  });

  it("keeps both platform sections available when detection fails", async () => {
    const { editor } = await mount(undefined, vi.fn().mockRejectedValue(new Error("Offline")));
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Mobile options"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('[role="status"]')).toBeNull();
    expect([...editor.shadowRoot!.querySelectorAll("nav button")]
      .some(button => button.textContent?.trim() === "Android")).toBe(true);
    expect([...editor.shadowRoot!.querySelectorAll("nav button")]
      .some(button => button.textContent?.trim() === "iOS / macOS")).toBe(true);
    await testUser().click([...editor.shadowRoot!.querySelectorAll("nav button")]
      .find(button => button.textContent?.includes("Recipients"))!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe("Unknown");
  });

  it.each([
    { key: "android", title: "Android" },
    { key: "ios", title: "iOS / macOS" },
  ])("hides unavailable $title child navigation", async ({ title }) => {
    const sendMessagePromise = vi.fn().mockResolvedValue({ platforms: [], unknown: false });
    const { editor } = await mount(undefined, sendMessagePromise);
    await vi.waitFor(() => expect(sendMessagePromise).toHaveBeenCalledOnce());
    await settleElement(editor);
    expect([...editor.shadowRoot!.querySelectorAll("nav button")]
      .some(button => button.textContent?.trim() === title)).toBe(false);
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