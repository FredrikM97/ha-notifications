// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { parse, stringify } from "yaml";
import { openEditor } from "../../frontend/editor/index.js";
import { finalizeAlert } from "../../frontend/editor/alert-model.js";
import { editorSections, rootSection, type EditorState } from "../../frontend/editor/sections.js";
import {
  cleanupTestDom,
  draftAlertFixture,
  editableAlert,
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
  const onValidateAlert = vi.fn().mockResolvedValue(undefined);
  openEditor({
    root,
    hass: homeAssistantFixture({ loadFragmentTranslation, connection: { sendMessagePromise } as never }),
    alert,
    defaults: draftAlertFixture(),
    users: [],
    onSave,
    onValidateAlert,
  });
  const editor = root.querySelector<LitElement>("ha-notifications-alert-editor")!;
  editor.style.setProperty("--primary-color", "#03a9f4");
  await settleElement(editor);
  return { editor, alert, onSave, onValidateAlert };
}

type NativeForm = HTMLElement & {
  schema: { name: string; selector: Record<string, unknown>; disabled?: boolean }[];
  data: Record<string, unknown>;
  computeLabel: (field: { name: string }) => string;
  computeHelper: (field: { name: string }) => string | undefined;
};

function sectionElement(editor: LitElement, key?: string): HTMLElement {
  return editor.shadowRoot!.querySelector<HTMLElement>(key ? `[data-section="${key}"]` : "[data-section]")!;
}

function sectionForms(editor: LitElement, key?: string): NativeForm[] {
  const section = sectionElement(editor);
  return [...section.querySelectorAll<NativeForm>("ha-form")]
    .filter(form => form.closest("[data-section]") === section && (!key || form.dataset.editorSection === key));
}

function nativeForm(editor: LitElement, name: string): NativeForm {
  const forms = sectionForms(editor)
    .filter(form => form.schema.some(field => field.name === name));
  expect(forms).toHaveLength(1);
  return forms[0];
}

type NativeSwitch = HTMLElement & { checked: boolean; disabled: boolean };

function booleanSwitch(editor: LitElement, name: string): NativeSwitch {
  const helperControl = sectionElement(editor).querySelector<NativeSwitch>(`.nc-option-inline[data-editor-field="${name}"] > ha-switch`);
  if (helperControl) return helperControl;
  const state = (editor as unknown as { state: EditorState }).state;
  const section = editorSections.find(section => section.key === sectionElement(editor).dataset.section)!;
  expect(section.optional).toBeDefined();
  expect(section.schema(state).find(field => field.name === name)?.selector).toHaveProperty("boolean");
  const label = state.localize(section.labels[name]);
  const switches = [...sectionElement(editor).querySelectorAll<NativeSwitch>(".nc-option > ha-switch")]
    .filter(control => control.getAttribute("aria-label") === label);
  expect(switches).toHaveLength(1);
  return switches[0];
}

function navigationItems(editor: LitElement): HTMLElement[] {
  return [...editor.shadowRoot!.querySelectorAll<HTMLElement>(".nc-layout > nav button, .nc-layout > .nc-nav-dropdown ha-dropdown-item")];
}

function localNavigationKeys(editor: LitElement): string[] {
  const state = (editor as unknown as { state: EditorState }).state;
  return navigationItems(editor).filter(item => item.classList.contains("nc-child"))
    .map(item => item.getAttribute("value") ?? editorSections.find(section =>
      state.localize(section.localTitle ?? section.title) === item.textContent?.trim())!.key);
}

async function selectNavigationItem(editor: LitElement, key: string): Promise<void> {
  const state = (editor as unknown as { state: EditorState }).state;
  const section = editorSections.find(section => section.key === key)!;
  const dropdown = editor.shadowRoot!.querySelector(".nc-layout > .nc-nav-dropdown");
  if (dropdown) {
    expect(navigationItems(editor).some(item => item.getAttribute("value") === key)).toBe(true);
    dropdown.dispatchEvent(new CustomEvent("wa-select", { detail: { item: { value: key } } }));
  } else {
    await testUser().click(navigationItems(editor)
      .find(button => button.textContent?.trim() === state.localize(section.parent ? section.localTitle ?? section.title : section.title))!);
  }
  await settleElement(editor);
}

async function selectSection(editor: LitElement, key: string): Promise<void> {
  const root = rootSection(key)!;
  await selectNavigationItem(editor, root.key);
  if (key !== root.key && !editorSections.find(section => section.key === key)!.embedded) await selectNavigationItem(editor, key);
}

async function changeField(editor: LitElement, name: string, value: unknown): Promise<void> {
  const form = sectionForms(editor).find(form => form.schema.some(field => field.name === name));
  if (form) {
    form.dispatchEvent(new CustomEvent("value-changed", {
      detail: { value: { [name]: value } },
    }));
  } else {
    expect(typeof value).toBe("boolean");
    const control = booleanSwitch(editor, name);
    control.checked = value as boolean;
    control.dispatchEvent(new Event("change"));
  }
  await settleElement(editor);
}

describe("native editor controls", () => {
  it.each([1100, 390].flatMap(width => [
    { width, key: "inactive", name: "clear_notification", label: "Clear notification" },
    { width, key: "notification", name: "use_default_tag", label: "Replace previous notifications" },
    { width, key: "confirmationNotification", name: "use_default_tag", label: "Replace previous notifications" },
  ]))("places $key boolean help immediately after label text before the separate switch at width $width", async ({ width, key, name, label }) => {
    const { editor } = await mount();
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    await selectSection(editor, key);
    const row = sectionElement(editor).querySelector<HTMLElement>(`.nc-option.nc-option-inline[data-editor-field="${name}"]`)!;
    const heading = row.querySelector(":scope > span.nc-heading")!;
    const text = heading.querySelector("span")!;
    const help = heading.querySelector<HTMLElement>("ha-icon-button")!;
    const control = booleanSwitch(editor, name);
    expect(text.textContent).toBe(label);
    expect([...heading.children]).toEqual([text, help]);
    expect([...row.children]).toEqual([heading, control]);
    expect(heading.hasAttribute("slot")).toBe(false);
    expect(row.querySelector("ha-settings-row")).toBeNull();
    expect(control.hasAttribute("slot")).toBe(false);
    expect(control.getAttribute("aria-label")).toBe(label);
    expect(row.querySelector("ha-form, ha-selector")).toBeNull();
    expect(row.querySelectorAll(".nc-help")).toHaveLength(1);
    expect(row.closest(".nc-field-input, .nc-compact")).toBeNull();
    const checked = control.checked;
    const state = (editor as unknown as { state: EditorState }).state;
    const section = editorSections.find(section => section.key === key)!;
    const before = structuredClone(section.read(state));
    if (control.disabled) {
      control.checked = !checked;
      control.dispatchEvent(new Event("change"));
      await settleElement(editor);
      expect(section.read(state)).toEqual(before);
    }
    await testUser().click(help);
    await settleElement(editor);
    expect(section.read(state)).toEqual(before);
    expect(editor.shadowRoot!.querySelector("ha-dialog")!.textContent)
      .toContain(state.localize(section.helpers![name]));
    expect(editor.shadowRoot!.querySelectorAll(".nc-help-topic")).toHaveLength(1);
  });

  it.each(["notification", "confirmationNotification"])("saves the default-tag toggle as metadata in %s without changing device options", async key => {
    const { editor, onSave } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.name = "Separate pushes";
    state.alert.notification.target = { entity_id: ["notify.phone"] };
    state.alert.confirmation.enabled = true;
    state.alert.confirmation.notification.enabled = true;
    const notification = key === "notification" ? state.alert.notification : state.alert.confirmation.notification;
    notification.options = { tag: "custom-tag", native_extra: { keep: true } };
    const originalOptions = structuredClone(notification.options);
    await selectSection(editor, key);
    const control = booleanSwitch(editor, "use_default_tag");
    expect(control.checked).toBe(true);
    expect(control.getAttribute("aria-label")).toBe("Replace previous notifications");
    const help = [...sectionElement(editor).querySelectorAll<HTMLElement>("ha-icon-button")]
      .find(button => button.getAttribute("title")?.endsWith(": Replace previous notifications"));
    expect(help).toBeDefined();
    expect(help!.parentElement!.className).toBe("nc-heading");
    expect(help!.parentElement!.hasAttribute("slot")).toBe(false);
    expect(help!.previousElementSibling?.tagName).toBe("SPAN");
    expect(help!.previousElementSibling?.textContent).toBe("Replace previous notifications");
    expect(help!.parentElement!.nextElementSibling).toBe(control);
    await testUser().click(help!);
    await settleElement(editor);
    expect(editor.shadowRoot!.textContent).toContain("An explicit options.tag is always preserved.");
    await testUser().click(editor.shadowRoot!.querySelector("ha-dialog ha-button")!);
    await settleElement(editor);
    await changeField(editor, "use_default_tag", false);
    expect(booleanSwitch(editor, "use_default_tag").checked).toBe(false);
    const saved = finalizeAlert(state.alert, state.postConfirmationActions);
    const stored = key === "notification" ? saved.notification : saved.confirmation!.notification;
    expect(stored.use_default_tag).toBe(false);
    expect(stored.options).toEqual(originalOptions);
    expect(stored.options).not.toHaveProperty("use_default_tag");
    const other = key === "notification" ? saved.confirmation!.notification : saved.notification;
    expect(other.use_default_tag).toBe(true);
    const reopened = editableAlert(saved);
    expect((key === "notification" ? reopened.notification : reopened.confirmation.notification).use_default_tag).toBe(false);
    await testUser().click([...editor.shadowRoot!.querySelectorAll<HTMLElement>("ha-button")]
      .find(button => button.textContent?.trim() === "Save alert")!);
    await settleElement(editor);
    expect(onSave).toHaveBeenCalledWith(saved);
  });

  it.each([
    { key: "notification", label: "Notification color" },
    { key: "android", label: "Channel LED color" },
    { key: "ios", label: "Icon glyph color" },
  ])("places the $label picker before its label", async ({ key, label }) => {
    const { editor } = await mount();
    await selectSection(editor, key);
    const picker = editor.shadowRoot!.querySelector(`input[type="color"][aria-label="${label} picker"]`)!;
    const row = picker.closest(".nc-option")!;
    expect(row.firstElementChild).toBe(picker.parentElement);
    expect(picker.parentElement!.nextElementSibling?.classList.contains("nc-heading")).toBe(true);
    expect(row.lastElementChild?.localName).toBe("ha-switch");
  });
  it("uses the same width for Notification title and general mobile inputs", async () => {
    const { editor } = await mount();
    await selectSection(editor, "notification");
    for (const name of ["title", "group", "notification_icon", "icon_url"]) {
      expect(nativeForm(editor, name).className).toBe("nc-field-form");
    }
    expect(nativeForm(editor, "message").className).toBe("");
    const styles = (editor.constructor as typeof LitElement).styles!.toString();
    expect(styles).toContain("--nc-standard-field-width: 400px;");
    expect(styles).toMatch(/ha-form\.nc-field-form\s*\{\s*width: 100%;\s*max-width: var\(--nc-field-width\);/);
  });
  it.each([
    { key: "notification", placeholder: "Notification message", label: "Message" },
    { key: "confirmationNotification", placeholder: "Confirmation message", label: "Confirmation message" },
  ])("uses a placeholder instead of a visible message label in $key", async ({ key, placeholder, label }) => {
    const { editor } = await mount();
    await selectSection(editor, key);
    const form = nativeForm(editor, "message");
    expect(form.computeLabel(form.schema[0])).toBe("");
    expect(form.schema[0].default).toBe(placeholder);
    expect(form.schema[0]).not.toHaveProperty("hideLabel");
    expect(form.getAttribute("aria-label")).toBe(label);
    const state = (editor as unknown as { state: EditorState }).state;
    const saved = finalizeAlert(state.alert, state.postConfirmationActions, false);
    expect(key === "notification" ? saved.notification.message : saved.confirmation?.notification.message).not.toBe(placeholder);
  });
  const children = ["triggers", "conditions", "inactive", "postSendActions", "android", "ios", "reminder", "confirmationNotification", "postConfirmationActions"];

  it.each([1100, 390])("offers five root tasks and all children with one selected section at width %s", async width => {
    const { editor } = await mount();
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    const navigation = navigationItems(editor);
    expect(navigation.filter(item => !item.classList.contains("nc-child")).map(item => item.textContent?.trim()))
      .toEqual(["Basics", "When", "Recipients", "Notification", "Confirmation"]);
    expect(localNavigationKeys(editor)).toEqual(children);
    for (const key of ["recipients", "notification", "postSendActions", "android", "ios"]) {
      expect(rootSection(key)?.key).toBe(key === "recipients" ? "recipients" : "notification");
      await selectSection(editor, key);
      const selected = navigationItems(editor).filter(item => item.getAttribute("aria-current") === "page" || item.hasAttribute("selected"));
      expect(selected).toHaveLength(1);
      expect(selected[0].classList.contains("nc-child")).toBe(Boolean(editorSections.find(section => section.key === key)!.parent));
      const state = (editor as unknown as { state: EditorState }).state;
      const section = editorSections.find(section => section.key === key)!;
      expect(selected[0].textContent?.trim()).toBe(state.localize(section.localTitle ?? section.title));
      expect(navigationItems(editor).filter(item => !item.classList.contains("nc-child"))).toHaveLength(5);
      expect(navigationItems(editor)).toHaveLength(14);
      expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe(state.localize(section.title));
      expect(editor.shadowRoot!.querySelectorAll("ha-card h2, ha-card h3")).toHaveLength(1);
      expect(editor.shadowRoot!.querySelector("ha-card h3")).toBeNull();
      expect(editor.shadowRoot!.querySelectorAll("[data-section]")).toHaveLength(1);
      expect(sectionElement(editor).dataset.section).toBe(key);
      expect(sectionForms(editor, key).every(form => form.dataset.editorSection === key)).toBe(true);
      expect(editor.shadowRoot!.querySelectorAll(".nc-nav-dropdown")).toHaveLength(width === 390 ? 1 : 0);
      expect(editor.shadowRoot!.querySelector("ha-tab-group, ha-tab-group-tab, .nc-local-nav")).toBeNull();
    }
    expect(localNavigationKeys(editor)).toEqual(children);
    expect(navigationItems(editor)
      .map(item => item.textContent?.trim())).toMatchSnapshot();
    expect(rootSection("unknown")).toBeUndefined();
  });

  it.each([1100, 390])("keeps all children visible independently of selection and enablement at width %s", async width => {
    const { editor } = await mount();
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.enabled = false;
    state.alert.monitor.triggers.enabled = false;
    state.alert.monitor.conditions.enabled = false;
    state.alert.confirmation.enabled = false;
    const before = finalizeAlert(state.alert, state.postConfirmationActions, false);
    for (const [root, localChildren] of [
      ["when", ["triggers", "conditions", "inactive"]],
      ["recipients", []],
      ["notification", ["postSendActions", "android", "ios"]],
      ["confirmation", ["reminder", "confirmationNotification", "postConfirmationActions"]],
      ["basic", []],
    ] as const) {
      await selectNavigationItem(editor, root);
      expect(localNavigationKeys(editor)).toEqual(children);
      expect(navigationItems(editor)).toHaveLength(14);
      expect(navigationItems(editor).filter(item => !item.classList.contains("nc-child"))
        .map(item => item.textContent?.trim())).toEqual(["Basics", "When", "Recipients", "Notification", "Confirmation"]);
      expect(sectionElement(editor).dataset.section).toBe(root);
      for (const child of localChildren) {
        await selectNavigationItem(editor, child);
        expect(sectionElement(editor).dataset.section).toBe(child);
        expect(editor.shadowRoot!.querySelectorAll("[data-section]")).toHaveLength(1);
        expect(localNavigationKeys(editor)).toEqual(children);
      }
    }
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
  });

  it.each([1100, 390])("opens the clicked parent instead of its previous child without altering the payload at width %s", async width => {
    const { editor } = await mount();
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.notification.message = "Door open";
    Object.assign(state.alert.notification.options!, { channel: "Security", custom: { keep: true } });
    const before = finalizeAlert(state.alert, state.postConfirmationActions, false);
    await selectSection(editor, "notification");
    const forms = sectionForms(editor, "notification");
    expect(forms).toHaveLength(2);
    expect(forms.flatMap(form => form.schema.map(field => field.name))).toEqual(["title", "message"]);
    expect(booleanSwitch(editor, "use_default_tag").checked).toBe(true);
    expect(editor.shadowRoot!.querySelectorAll("ha-card")).toHaveLength(1);
    expect(editor.shadowRoot!.querySelector("ha-card ha-card")).toBeNull();
    expect(editor.shadowRoot!.querySelector("details")).toBeNull();
    await selectSection(editor, "android");
    expect(nativeForm(editor, "channel").data.channel).toBe("Security");
    await selectSection(editor, "conditions");
    await selectSection(editor, "basic");
    await selectNavigationItem(editor, "notification");
    expect(sectionElement(editor, "notification")).not.toBeNull();
    expect(sectionElement(editor, "android")).toBeNull();
    expect(nativeForm(editor, "message").data.message).toBe("Door open");
    await selectNavigationItem(editor, "android");
    expect(sectionElement(editor, "android")).not.toBeNull();
    expect(nativeForm(editor, "channel").data.channel).toBe("Security");
    await selectNavigationItem(editor, "when");
    expect(sectionElement(editor, "when")).not.toBeNull();
    expect(sectionElement(editor, "conditions")).toBeNull();
    resize([{ contentRect: { width: width === 1100 ? 390 : 1100 } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    expect(sectionElement(editor, "when")).not.toBeNull();
    expect(editor.shadowRoot!.querySelectorAll("[data-section]")).toHaveLength(1);
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
    expect(editor.shadowRoot!.querySelector(".nc-dirty")!.textContent).toBe("");
  });

  it("keeps trigger and condition validation actions in their own groups", async () => {
    const { editor, onValidateAlert } = await mount();
    await selectSection(editor, "when");
    expect(sectionElement(editor).querySelector("ha-icon-overflow-menu")).toBeNull();
    for (const key of ["triggers", "conditions"]) {
      await selectSection(editor, key);
      const menu = sectionElement(editor, key).querySelector("ha-icon-overflow-menu") as HTMLElement & {
        items: { label: string; action: () => Promise<void> }[];
      };
      expect(menu.items).toHaveLength(1);
      const state = (editor as unknown as { state: EditorState }).state;
      expect(menu.items[0].label).toBe(state.localize(editorSections.find(section => section.key === key)!.validate!.label));
      await menu.items[0].action();
      expect(onValidateAlert).toHaveBeenLastCalledWith(finalizeAlert(state.alert, state.postConfirmationActions, false));
    }
    expect(onValidateAlert).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, false, true])("requires explicit confirmation follow-up enablement in the visible controls with enabled=%s", async enabled => {
    const alert = draftAlertFixture();
    alert.confirmation.notification = { title: "", message: "Done", options: {} };
    if (enabled !== undefined) alert.confirmation.notification.enabled = enabled;
    const { editor } = await mount(undefined, undefined, alert);
    await selectSection(editor, "confirmationNotification");
    const toggle = sectionElement(editor).querySelector(".card-header ha-switch") as NativeSwitch;
    const form = nativeForm(editor, "message");
    expect(toggle.checked).toBe(enabled === true);
    expect(form.data.message).toBe("Done");
    expect(Boolean(form.schema[0].disabled)).toBe(enabled !== true);
    toggle.checked = enabled !== true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(toggle.checked).toBe(enabled !== true);
    expect(Boolean(form.schema[0].disabled)).toBe(enabled === true);
    expect(form.data.message).toBe("Done");
    const state = (editor as unknown as { state: EditorState }).state;
    expect(finalizeAlert(state.alert, false, false).confirmation!.notification.enabled).toBe(enabled !== true);
  });

  it("keeps configured confirmation subpanels accessible when confirmation is disabled", async () => {
    const { editor } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.confirmation.enabled = true;
    state.alert.confirmation.reminders.enabled = true;
    state.alert.confirmation.notification.enabled = true;
    state.alert.confirmation.notification.message = "Confirmed by {{ confirmed_by }}";
    state.alert.confirmation.actions = [{ action: "light.turn_on", target: { entity_id: "light.hall" } }];
    state.postConfirmationActions = true;
    await selectSection(editor, "confirmation");
    expect(localNavigationKeys(editor)).toEqual(children);
    expect(navigationItems(editor).map(item => item.textContent?.trim())).toMatchSnapshot();
    const toggle = sectionElement(editor).querySelector(":scope > .card-header ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    await selectSection(editor, "confirmationNotification");
    expect(nativeForm(editor, "message").data.message).toBe("Confirmed by {{ confirmed_by }}");
    expect(nativeForm(editor, "message").schema[0].disabled).toBeUndefined();
    await selectSection(editor, "postConfirmationActions");
    expect(nativeForm(editor, "actions").data.actions).toEqual(state.alert.confirmation.actions);
    expect(state.alert.confirmation.enabled).toBe(false);
    expect(state.alert.confirmation.reminders.enabled).toBe(true);
    expect(state.alert.confirmation.notification.enabled).toBe(true);
    expect(state.postConfirmationActions).toBe(true);
  });

  it("keeps local enablement and help independent of navigation", async () => {
    const { editor } = await mount();
    await selectSection(editor, "postSendActions");
    const section = sectionElement(editor);
    const state = (editor as unknown as { state: EditorState }).state;
    const toggle = section.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    expect(toggle.checked).toBe(false);
    expect(nativeForm(editor, "actions").schema[0].disabled).toBe(true);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    const configured = [{ action: "light.turn_on", target: { entity_id: "light.hall" } }];
    await changeField(editor, "actions", configured);
    await testUser().click(section.querySelector(".nc-help")!);
    await settleElement(editor);
    expect(sectionElement(editor)).toBe(section);
    expect(editor.shadowRoot!.querySelector("ha-dialog")).not.toBeNull();
    await testUser().click(editor.shadowRoot!.querySelector("ha-dialog ha-button")!);
    await settleElement(editor);
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    await selectSection(editor, "notification");
    await selectSection(editor, "postSendActions");
    expect(state.alert.post_send_actions).toEqual({ enabled: false, actions: configured });
    expect(nativeForm(editor, "actions").schema[0].disabled).toBe(true);
    expect(nativeForm(editor, "actions").data.actions).toEqual(configured);
  });

  it("retains disabled configured Android settings when recipients are detected as iOS only", async () => {
    const { editor } = await mount(undefined, vi.fn().mockResolvedValue({ platforms: ["ios"], unknown: false }));
    const state = (editor as unknown as { state: EditorState }).state;
    const section = editorSections.find(section => section.key === "android")!;
    section.write(state, { channel: "Security", persistent: false, timeout: 0 });
    section.toggle!.set(state, false);
    await selectSection(editor, "android");
    expect(nativeForm(editor, "channel").data.channel).toBe("Security");
    expect(booleanSwitch(editor, "persistent").checked).toBe(false);
    expect(booleanSwitch(editor, "persistent").disabled).toBe(true);
    expect(nativeForm(editor, "timeout").data.timeout).toBe(0);
    expect(nativeForm(editor, "channel").schema[0].disabled).toBe(true);
    expect(localNavigationKeys(editor)).toContain("android");
  });

  it.each([1100, 390])("falls back to Notification when detection removes the active platform at width %s", async width => {
    let detected!: (value: { platforms: string[]; unknown: boolean }) => void;
    const sendMessagePromise = vi.fn()
      .mockResolvedValueOnce({ platforms: ["android"], unknown: false })
      .mockImplementationOnce(() => new Promise(resolve => { detected = resolve; }));
    const { editor } = await mount(undefined, sendMessagePromise);
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    await selectSection(editor, "recipients");
    await changeField(editor, "target", { device_id: ["ios-phone"] });
    await selectSection(editor, "android");
    expect(localNavigationKeys(editor)).toContain("android");
    detected({ platforms: ["ios"], unknown: false });
    await settleElement(editor);
    expect(localNavigationKeys(editor)).not.toContain("android");
    expect(localNavigationKeys(editor)).toContain("ios");
    expect(sectionElement(editor).dataset.section).toBe("notification");
    expect(nativeForm(editor, "message").dataset.editorSection).toBe("notification");
    expect(editor.shadowRoot!.querySelectorAll("[data-section]")).toHaveLength(1);
    const state = (editor as unknown as { state: EditorState }).state;
    expect(state.mobileDrafts?.android?.enabled).not.toBe(true);
  });

  it("keeps message content out of Android options", () => {
    const state: EditorState = {
      alert: editableAlert(draftAlertFixture()),
      hass: homeAssistantFixture(),
      localize: () => "",
      postConfirmationActions: false,
      users: [],
    };
    state.alert.notification.title = "Door";
    state.alert.notification.message = "Door opened";
    state.alert.notification.options!.subject = "Native YAML value";
    const section = editorSections.find(item => item.key === "android")!;
    const fields = section.schema(state).map(item => item.name);
    expect(fields).not.toContain("subject");
    expect(fields).not.toContain("message");
    expect(fields).not.toContain("title");
    section.write(state, { channel: "Security", persistent: true });
    expect(state.alert.notification.title).toBe("Door");
    expect(state.alert.notification.message).toBe("Door opened");
    expect(state.alert.notification.options!).not.toHaveProperty("title");
    expect(state.alert.notification.options!).not.toHaveProperty("message");
    expect(finalizeAlert(state.alert, false, false).notification.options!.subject).toBe("Native YAML value");
  });

  it("edits canonical options without changing native extras", () => {
    const notification = {
      target: { entity_id: ["notify.phone"] },
      title: "Door", message: "Open", options: { channel: "Native service field", push: ["opaque"], native_extra: { keep: true } },
    };
    const state: EditorState = {
      alert: editableAlert(draftAlertFixture({ name: "Door", notification })),
      hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    const section = editorSections.find(section => section.key === "android")!;
    expect(section.read(state).channel).toBe("Native service field");
    section.write(state, { channel: "Security", persistent: false, timeout: 0 });
    expect(finalizeAlert(state.alert, false).notification).toEqual({
      ...notification,
      use_default_tag: true,
      options: { ...notification.options, channel: "Security", persistent: false, timeout: 0 },
    });
  });

  it.each([false, true])("saves canonical notification and confirmation text with mobile options %s", async mobile => {
    const alert = draftAlertFixture({
      name: "Door",
      notification: {
        target: { entity_id: ["notify.phone"] },
        title: "Original title", message: "Original message", options: { native_extra: { keep: true }, custom: { keep: true } },
      },
    });
    alert.confirmation!.notification = {
      enabled: true,
      title: "Confirmation title", message: "Original confirmation", options: { native_extra: ["keep"], custom: { keep: true } },
    };
    const { editor, onSave } = await mount(undefined, undefined, alert);
    await selectSection(editor, "notification");
    expect(nativeForm(editor, "title").data.title).toBe("Original title");
    expect(nativeForm(editor, "message").data.message).toBe("Original message");
    await changeField(editor, "title", "Door title");
    await changeField(editor, "message", "Door opened");
    const state = (editor as unknown as { state: EditorState }).state;
    if (mobile) {
      const enableOption = async (key: string, name: string) => {
        const section = editorSections.find(section => section.key === key)!;
        const label = state.localize(section.labels[name]);
        const control = sectionElement(editor).querySelector(`[aria-label="Enable ${label}"]`) as NativeSwitch;
        control.checked = true;
        control.dispatchEvent(new Event("change"));
        await settleElement(editor);
      };
      await enableOption("mobile", "group");
      await changeField(editor, "group", "doors");
      for (const key of ["android", "ios"]) {
        await selectSection(editor, key);
        const toggle = sectionElement(editor).querySelector(".card-header ha-switch") as NativeSwitch;
        toggle.checked = true;
        toggle.dispatchEvent(new Event("change"));
        await settleElement(editor);
        if (key === "android") {
          await enableOption(key, "channel");
          await changeField(editor, "channel", "Security");
          await changeField(editor, "persistent", true);
        } else {
          await enableOption(key, "sound");
          await enableOption(key, "badge");
          await changeField(editor, "sound", "default");
          await changeField(editor, "badge", 0);
        }
      }
    }
    await selectSection(editor, "confirmationNotification");
    expect(nativeForm(editor, "message").data.message).toBe("Original confirmation");
    await changeField(editor, "message", "Confirmed by {{ confirmed_by }}");
    await testUser().click(editor.shadowRoot!.querySelector("ha-top-app-bar-fixed ha-button")!);
    await settleElement(editor);
    expect(onSave).toHaveBeenCalledOnce();
    const saved = onSave.mock.calls[0][0];
    expect(saved.notification).toEqual({
      target: { entity_id: ["notify.phone"] },
      use_default_tag: true,
      title: "Door title", message: "Door opened", options: { native_extra: { keep: true }, custom: { keep: true }, ...(mobile ? { group: "doors", channel: "Security", persistent: true, push: { sound: "default", badge: 0 } } : {}) },
    });
    expect(saved.confirmation.notification).toEqual({
      enabled: true,
      use_default_tag: true,
      title: "Confirmation title", message: "Confirmed by {{ confirmed_by }}", options: { native_extra: ["keep"], custom: { keep: true } },
    });
    expect(saved.notification).not.toHaveProperty("data");
    expect(saved.confirmation.notification).not.toHaveProperty("data");
    expect(saved.notification.options!).not.toHaveProperty("title");
    expect(saved.notification.options!).not.toHaveProperty("message");
    expect(saved.confirmation.notification.options!).not.toHaveProperty("title");
    expect(saved.confirmation.notification.options!).not.toHaveProperty("message");
  });

  it.each([1100, 390])("classifies fields with responsive standard and compact presets at viewport %s", async viewport => {
    const { editor } = await mount();
    resize([{ contentRect: { width: viewport } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    const state = (editor as unknown as { state: EditorState }).state;
    const layouts: Record<string, unknown> = {};
    const cases: { key: string; values: Record<string, unknown>; scalars: string[] }[] = [
      { key: "basic", values: { name: "Door", description: "Front door\nUpstairs", icon: "mdi:door" }, scalars: ["name", "description", "icon"] },
      { key: "when", values: { automation_mode: "queued" }, scalars: ["automation_mode"] },
      { key: "notification", values: { title: "Door open", message: "{{ now() }}" }, scalars: ["title"] },
      { key: "mobile", values: { group: "doors", notification_icon: "mdi:door", icon_url: "https://example.com/icon.png" }, scalars: ["group", "notification_icon", "icon_url"] },
      { key: "android", values: { channel: "Security", importance: "high", visibility: "private", timeout: 0, clickAction: "https://example.com", vibrationPattern: "100, 200" }, scalars: ["channel", "importance", "clickAction", "timeout", "visibility", "vibrationPattern"] },
      { key: "ios", values: { "interruption-level": "time-sensitive", badge: 0, presentation_options: ["alert", "sound"], url: "https://example.com", subtitle: "Door", sound: "default" }, scalars: ["subtitle", "url", "interruption-level", "badge"] },
      { key: "conditions", values: { startup: true, periodic: true, interval: { minutes: 5 }, conditions: [] }, scalars: ["interval"] },
      { key: "confirmation", values: { buttons: [{ label: "Done", id: "done" }], forget_after_enabled: true, timeout: { minutes: 15 } }, scalars: ["timeout"] },
      { key: "reminder", values: { interval: { minutes: 3 }, max_attempts: 4, show_attempts: true }, scalars: ["interval", "max_attempts"] },
    ];
    for (const { key, values, scalars } of cases) {
      const section = editorSections.find(section => section.key === key)!;
      section.write(state, values);
      expect(section.schema(state).every(field => !("width" in field) && !("compact" in field))).toBe(true);
      const before = finalizeAlert(state.alert, state.postConfirmationActions, false);
      await selectSection(editor, key);
      const forms = sectionForms(editor, key);
      if (section.optional) {
        expect(forms.flatMap(form => form.schema).some(field => "boolean" in field.selector)).toBe(false);
      }
      for (const form of forms) {
        expect(form.schema.every(field => !("width" in field) && !("compact" in field))).toBe(true);
        expect(form.schema).toHaveLength(1);
        const scalar = scalars.includes(form.schema[0].name);
        const compact = scalar && ["number", "duration", "select"].some(type => type in form.schema[0].selector);
        expect(form.className).toBe(scalar ? `nc-field-form${compact ? " nc-compact" : ""}` : "");
        expect(form.data).toMatchObject(section.read(state));
        const wrapper = form.closest(".nc-option-input");
        if (wrapper) {
          expect(wrapper.classList.contains("nc-field-input")).toBe(scalar);
          expect(wrapper.classList.contains("nc-compact")).toBe(compact);
          const help = wrapper.querySelector(".nc-help");
          if (help) {
            expect(wrapper.firstElementChild).toBe(form);
            expect(wrapper.lastElementChild).toBe(help);
          }
        }
        expect((form as NativeForm & { narrow: boolean }).narrow).toBe(viewport < 870);
      }
      expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
      expect(editor.shadowRoot!.querySelector(".nc-dirty")!.textContent).toBe("");
      layouts[key] = forms.map(form => ({
        class: form.className,
        wrapper: form.closest(".nc-option-input")?.className ?? null,
        schema: form.schema,
        label: form.computeLabel(form.schema[0]),
      }));
    }
    expect(layouts).toMatchSnapshot();
    const styles = (editor.constructor as typeof LitElement).styles!.toString();
    expect(styles).toMatch(/:host\s*\{\s*--nc-standard-field-width: 400px;\s*--nc-compact-field-width: 360px;\s*--nc-field-width: var\(--nc-standard-field-width\);\s*--nc-help-width: 32px;/);
    expect(styles).toMatch(/\.nc-compact\s*\{\s*--nc-field-width: var\(--nc-compact-field-width\);/);
    expect(styles).toMatch(/ha-form\.nc-field-form\s*\{\s*width: 100%;\s*max-width: var\(--nc-field-width\);/);
    expect(styles).toMatch(/\.nc-option-input\.nc-field-input\s*\{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) var\(--nc-help-width\);\s*flex: 0 1 calc\(var\(--nc-field-width\) \+ var\(--nc-help-width\) \+ var\(--ha-space-2, 8px\)\);\s*width: 100%;\s*max-width: calc\(var\(--nc-field-width\) \+ var\(--nc-help-width\) \+ var\(--ha-space-2, 8px\)\);/);
    expect(styles).not.toMatch(/nc-(compact|medium)-(form|input)/);
    expect(styles).not.toContain('[data-embedded-section="mobile"] .nc-option-input');
  });

  it.each([1100, 390])("keeps structured selectors and boolean rows uncapped at viewport %s", async viewport => {
    const { editor } = await mount();
    resize([{ contentRect: { width: viewport } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    const state = (editor as unknown as { state: EditorState }).state;
    const cases = [
      { key: "ios", name: "sound", values: { sound: "default" } },
      { key: "ios", name: "sound", values: { sound: { name: "default", critical: 1, volume: 0.8 } } },
      { key: "ios", name: "presentation_options", values: { presentation_options: ["alert", "sound"] } },
      { key: "notification", name: "message", values: {} },
      { key: "confirmationNotification", name: "message", values: {} },
      { key: "triggers", name: "triggers", values: {} },
      { key: "conditions", name: "conditions", values: {} },
      { key: "confirmation", name: "buttons", values: {} },
      { key: "postSendActions", name: "actions", values: {} },
      { key: "postConfirmationActions", name: "actions", values: {} },
      { key: "recipients", name: "target", values: {} },
    ];
    for (const { key, name, values } of cases) {
      if (Object.keys(values).length) editorSections.find(section => section.key === key)!.write(state, values);
      await selectSection(editor, key);
      const form = nativeForm(editor, name);
      expect(form.className).toBe("");
      expect(form.closest(".nc-field-input")).toBeNull();
      expect(form.closest(".nc-compact")).toBeNull();
      expect(form.schema.every(field => !("width" in field))).toBe(true);
    }
    await selectSection(editor, "android");
    const control = booleanSwitch(editor, "persistent");
    expect(control.closest(".nc-field-input")).toBeNull();
    expect(control.closest(".nc-compact")).toBeNull();
    expect(control.closest(".nc-option")!.querySelector("ha-form, .nc-option-input")).toBeNull();
  });

  it.each([1100, 390])("reserves the preset input width and shared help slot for Android scalars at width %s", async width => {
    const { editor } = await mount();
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    await selectSection(editor, "android");
    for (const [name, compact, hasHelp] of [
      ["channel", false, true], ["clickAction", false, false], ["vibrationPattern", false, true],
      ["importance", true, true], ["visibility", true, false], ["timeout", true, false],
    ] as const) {
      const form = nativeForm(editor, name);
      const wrapper = form.parentElement!;
      expect(wrapper.className).toBe(`nc-option-input nc-field-input${compact ? " nc-compact" : ""}`);
      expect(form.className).toBe(`nc-field-form${compact ? " nc-compact" : ""}`);
      expect(wrapper.firstElementChild).toBe(form);
      expect(wrapper.querySelectorAll(".nc-help")).toHaveLength(hasHelp ? 1 : 0);
      expect([...wrapper.children]).toEqual(hasHelp ? [form, wrapper.querySelector(".nc-help")] : [form]);
      expect(form.computeHelper(form.schema[0])).toBeUndefined();
    }
    const sheet = new CSSStyleSheet();
    sheet.replaceSync((editor.constructor as typeof LitElement).styles!.toString());
    const style = (selector: string) => (Array.from(sheet.cssRules)
      .find(rule => (rule as CSSStyleRule).selectorText === selector) as CSSStyleRule).style;
    const wrapperStyle = style(".nc-option-input.nc-field-input");
    expect(wrapperStyle.display).toBe("grid");
    expect(wrapperStyle.gridTemplateColumns).toBe("minmax(0, 1fr) var(--nc-help-width)");
    expect((editor.constructor as typeof LitElement).styles!.toString())
      .toContain("flex: 0 1 calc(var(--nc-field-width) + var(--nc-help-width) + var(--ha-space-2, 8px));");
    expect(wrapperStyle.width).toBe("100%");
    expect(wrapperStyle.maxWidth).toBe("calc(var(--nc-field-width) + var(--nc-help-width) + var(--ha-space-2, 8px))");
    expect(style(".nc-option-input").gap).toBe("var(--ha-space-2, 8px)");
    expect(style("ha-form.nc-field-form").maxWidth).toBe("var(--nc-field-width)");
    const styles = (editor.constructor as typeof LitElement).styles!.toString();
    expect(styles).toContain("--nc-standard-field-width: 400px;");
    expect(styles).toContain("--nc-compact-field-width: 360px;");
    expect(styles).toContain("--nc-field-width: var(--nc-standard-field-width);");
    expect(styles).toContain("--nc-help-width: 32px;");
    expect(style(".nc-compact").getPropertyValue("--nc-field-width")).toBe("var(--nc-compact-field-width)");
  });

  it.each([
    { selector: { text: {} }, className: "nc-field-form" },
    { selector: { icon: {} }, className: "nc-field-form" },
    { selector: { number: { mode: "box" } }, className: "nc-field-form nc-compact" },
    { selector: { duration: { enable_day: true } }, className: "nc-field-form nc-compact" },
    { selector: { select: { options: ["default"] } }, className: "nc-field-form nc-compact" },
    { selector: { select: { multiple: true, options: ["default"] } }, className: "" },
    { selector: { boolean: {} }, className: "" },
    { selector: { object: {} }, className: "" },
  ])("derives the preset from selector $selector without leaking layout metadata into HA schemas", async ({ selector, className }) => {
    const { editor } = await mount();
    const section = editorSections.find(section => section.key === "notification")!;
    const schema = [{ name: "title", selector }];
    vi.spyOn(section, "schema").mockReturnValue(schema);
    await selectSection(editor, "notification");
    const form = nativeForm(editor, "title");
    expect(form.className).toBe(className);
    expect(form.schema).toEqual(schema);
    expect(form.schema[0]).not.toHaveProperty("width");
    expect(form.schema[0]).not.toHaveProperty("compact");
    expect(form.schema[0].selector).not.toHaveProperty("compact");
  });

  it.each([{ list: {} }, { object: {} }, { select: { multiple: true, options: ["alert", "sound"] } }])("does not cap a structured selector %j even in a scalar section", async selector => {
    const { editor } = await mount();
    const section = editorSections.find(section => section.key === "notification")!;
    vi.spyOn(section, "schema").mockReturnValue([{ name: "title", selector }]);
    await selectSection(editor, "notification");
    expect(nativeForm(editor, "title").className).toBe("");
  });

  it.each([
    { key: "triggers", name: "triggers" },
    { key: "conditions", name: "conditions" },
    { key: "inactive", name: "triggers" },
    { key: "postSendActions", name: "actions" },
    { key: "postConfirmationActions", name: "actions" },
  ])("does not apply a custom native selector theme in $key", async ({ key, name }) => {
    const { editor } = await mount();
    await selectSection(editor, key);
    expect(nativeForm(editor, name).className).toBe("");
    const styles = (editor.constructor as typeof LitElement).styles!.toString();
    expect(styles).not.toContain("nc-native-form");
    expect(nativeForm(editor, name).style.color).toBe("");
    expect(nativeForm(editor, name).style.backgroundColor).toBe("");
  });

  it.each([1100, 390])("uses one external label style and accessible native selector names at width %s", async width => {
    const { editor } = await mount();
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.monitor.triggers.items = [{ trigger: "event", event_type: "door_open", alias: "Door", custom: { keep: true } }];
    state.alert.monitor.conditions.items = [{ condition: "template", value_template: "{{ true }}", alias: "Check" }];
    state.alert.monitor.inactive.items = [{ trigger: "event", event_type: "door_closed" }];
    state.alert.post_send_actions = { enabled: true, actions: [{ action: "light.turn_on", target: { entity_id: "light.hall" } }] };
    state.alert.confirmation.actions = [{ action: "light.turn_off", target: { entity_id: "light.hall" } }];
    const before = finalizeAlert(state.alert, state.postConfirmationActions, false);
    for (const [key, name, selector] of [
      ["triggers", "triggers", "trigger"],
      ["conditions", "conditions", "condition"],
      ["inactive", "triggers", "trigger"],
      ["postSendActions", "actions", "action"],
      ["postConfirmationActions", "actions", "action"],
    ]) {
      await selectSection(editor, key);
      const section = editorSections.find(section => section.key === key)!;
      const form = nativeForm(editor, name);
      const wrapper = form.parentElement!;
      const label = state.localize(section.labels[name]);
      expect(wrapper.className).toBe("nc-native-selector");
      expect(wrapper.querySelectorAll(".nc-native-label")).toHaveLength(1);
      expect(wrapper.querySelector(".nc-native-label")!.textContent).toBe(label);
      expect(wrapper.querySelector(".nc-native-label")!.getAttribute("role")).toBe("heading");
      expect(wrapper.children[0].nextElementSibling).toBe(form);
      expect(form.getAttribute("aria-label")).toBe(label);
      expect(form.computeLabel(form.schema[0])).toBe("");
      expect(form.schema).toHaveLength(1);
      expect(form.schema[0]).toMatchObject({ name, selector: { [selector]: {} } });
      expect(form.schema[0]).not.toHaveProperty("label");
      expect(form.data).toEqual(section.read(state));
      expect(form.className).toBe("");
    }
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
    const styles = (editor.constructor as typeof LitElement).styles!.toString();
    expect(styles).toMatch(/\.nc-native-label\s*\{\s*font-size: var\(--ha-font-size-m, 16px\);\s*font-weight: var\(--ha-font-weight-medium, 500\);\s*color: var\(--secondary-text-color\);/);
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

  it.each([
    { key: "mobile", name: "group", value: "doors", hasHelp: true },
    { key: "mobile", name: "notification_icon", value: "mdi:door", hasHelp: true },
    { key: "android", name: "channel", value: "Security", hasHelp: true },
    { key: "android", name: "importance", value: "high", hasHelp: true },
    { key: "android", name: "timeout", value: 0, hasHelp: false },
    { key: "ios", name: "badge", value: 0, hasHelp: false },
    { key: "ios", name: "presentation_options", value: ["alert", "sound"], hasHelp: false },
    { key: "ios", name: "sound", value: "default", hasHelp: true },
  ])("keeps the same $key $name form visible, guards disabled writes and retains help", async ({ key, name, value, hasHelp }) => {
    const { editor } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    const before = finalizeAlert(state.alert, state.postConfirmationActions, false);
    await selectSection(editor, key);
    const form = nativeForm(editor, name);
    const row = form.closest(".nc-option")!;
    const option = row.querySelector("ha-switch") as HTMLElement & { checked: boolean; disabled: boolean };
    const help = row.querySelector<HTMLElement>(".nc-help")!;
    const dimensions = () => ({
      form: form.className,
      wrapper: form.parentElement!.className,
      formStyle: form.getAttribute("style"),
      wrapperStyle: form.parentElement!.getAttribute("style"),
    });
    const disabledDimensions = dimensions();
    expect(form.computeHelper(form.schema[0])).toBeUndefined();
    expect(form.schema[0].disabled).toBe(true);
    expect(option.checked).toBe(false);
    expect(Boolean(help)).toBe(hasHelp);
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
    expect(editor.shadowRoot!.querySelector(".nc-dirty")!.textContent).toBe("");
    await changeField(editor, name, value);
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
    if (key !== "mobile") {
      expect(option.disabled).toBe(true);
      option.checked = true;
      option.dispatchEvent(new Event("change"));
      await settleElement(editor);
      expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
      const sectionToggle = sectionElement(editor).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
      sectionToggle.checked = true;
      sectionToggle.dispatchEvent(new Event("change"));
      await settleElement(editor);
      expect(nativeForm(editor, name)).toBe(form);
      expect(form.schema[0].disabled).toBe(true);
      expect(option.disabled).toBe(false);
      const sectionEnabled = finalizeAlert(state.alert, state.postConfirmationActions, false);
      await changeField(editor, name, value);
      expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(sectionEnabled);
    }
    if (hasHelp) {
      await testUser().click(help);
      await settleElement(editor);
      expect(editor.shadowRoot!.querySelector("ha-dialog")!.textContent?.trim()).not.toBe("");
      await testUser().click(editor.shadowRoot!.querySelector("ha-dialog ha-button")!);
      await settleElement(editor);
    }
    option.checked = true;
    option.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(nativeForm(editor, name)).toBe(form);
    expect(form.schema[0].disabled).toBeUndefined();
    expect(dimensions()).toEqual(disabledDimensions);
    expect(row.querySelector(".nc-help")).toBe(help);
    await changeField(editor, name, value);
    expect(editorSections.find(section => section.key === key)!.read(state)[name]).toEqual(value);
    option.checked = false;
    option.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(nativeForm(editor, name)).toBe(form);
    expect(form.schema[0].disabled).toBe(true);
    expect(row.querySelector(".nc-help")).toBe(help);
    expect(dimensions()).toEqual(disabledDimensions);
    const fieldDisabled = finalizeAlert(state.alert, state.postConfirmationActions, false);
    await changeField(editor, name, "ignored");
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(fieldDisabled);
    option.checked = true;
    option.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(nativeForm(editor, name)).toBe(form);
    expect(form.data[name]).toEqual(value);
    expect(dimensions()).toEqual(disabledDimensions);
    if (key !== "mobile") {
      const sectionToggle = sectionElement(editor).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
      sectionToggle.checked = false;
      sectionToggle.dispatchEvent(new Event("change"));
      await settleElement(editor);
      expect(nativeForm(editor, name)).toBe(form);
      expect(form.schema[0].disabled).toBe(true);
      expect(option.checked).toBe(true);
      expect(option.disabled).toBe(true);
      const sectionDisabled = finalizeAlert(state.alert, state.postConfirmationActions, false);
      await changeField(editor, name, "ignored");
      expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(sectionDisabled);
      expect(form.data[name]).toEqual(value);
      expect(dimensions()).toEqual(disabledDimensions);
    }
  });

  it.each(["sticky", "persistent", "alert_once"])("keeps %s as a direct boolean switch and guards writes when Android is off", async name => {
    const { editor } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    const before = finalizeAlert(state.alert, state.postConfirmationActions, false);
    await selectSection(editor, "android");
    const control = booleanSwitch(editor, name);
    const row = control.closest(".nc-option")!;
    const heading = row.querySelector(".nc-heading")!;
    expect(row.querySelector("ha-form, .nc-option-input, p")).toBeNull();
    expect(row.querySelectorAll("ha-switch")).toHaveLength(1);
    expect(row.querySelectorAll(".nc-help")).toHaveLength(1);
    const section = editorSections.find(section => section.key === "android")!;
    const label = state.localize(section.labels[name]);
    const description = state.localize(section.helpers![name]);
    const help = row.querySelector<HTMLElement>(".nc-help")!;
    expect(help.getAttribute("title")).toBe(`More information: ${label}`);
    expect(heading.textContent).toBe(label);
    const text = heading.querySelector(":scope > span")!;
    expect(text.textContent).toBe(label);
    expect([...heading.children]).toEqual([text, help]);
    expect([...row.children]).toEqual([heading, control]);
    expect(heading.hasAttribute("slot")).toBe(false);
    expect(control.getAttribute("aria-label")).toBe(label);
    expect(control.checked).toBe(Boolean(section.read(state)[name]));
    expect(control.disabled).toBe(true);
    expect({
      row: row.className,
      heading: { class: heading.className, text: heading.textContent, help: help.getAttribute("title") },
      switch: { label: control.getAttribute("aria-label"), checked: control.checked, disabled: control.disabled },
      description,
    }).toMatchSnapshot();
    await testUser().click(help);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-dialog")!.textContent).toContain(description);
    expect(editor.shadowRoot!.querySelectorAll(".nc-help-topic")).toHaveLength(1);
    expect(editor.shadowRoot!.querySelector(".nc-help-topic h3")).toBeNull();
    await testUser().click(editor.shadowRoot!.querySelector("ha-dialog ha-button")!);
    await settleElement(editor);
    const write = vi.spyOn(section, "write");
    const changed = vi.spyOn(editor as unknown as { changed: () => void }, "changed");
    await changeField(editor, name, true);
    expect(write).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
    expect(editor.shadowRoot!.querySelector(".nc-dirty")!.textContent).toBe("");
    const toggle = sectionElement(editor).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(booleanSwitch(editor, name)).toBe(control);
    expect(control.disabled).toBe(false);
    expect([...row.querySelectorAll(".nc-help")]).toEqual([help]);
    write.mockClear();
    changed.mockClear();
    const siblings = structuredClone(state.alert.notification.options!);
    await changeField(editor, name, true);
    expect(write).toHaveBeenCalledExactlyOnceWith(state, { [name]: true });
    expect(changed).toHaveBeenCalledOnce();
    expect(state.alert.notification.options!).toEqual({ ...siblings, [name]: true });
    expect(control.checked).toBe(true);
    expect(control.checked).toBe(section.read(state)[name]);
    expect(editor.shadowRoot!.querySelector(".nc-dirty")!.textContent).not.toBe("");
    await changeField(editor, name, false);
    expect(state.alert.notification.options![name]).toBe(false);
    expect(control.checked).toBe(false);
    expect(control.checked).toBe(section.read(state)[name]);
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(control.disabled).toBe(true);
    const disabled = finalizeAlert(state.alert, state.postConfirmationActions, false);
    write.mockClear();
    changed.mockClear();
    await changeField(editor, name, true);
    expect(write).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(disabled);
  });

  it.each([
    { key: "android", name: "ledColor", label: "Channel LED color" },
    { key: "ios", name: "notification_icon_color", label: "Icon glyph color" },
  ])("guards the always-visible $key $name picker when either switch is off", async ({ key, name, label }) => {
    const { editor } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    const before = finalizeAlert(state.alert, state.postConfirmationActions, false);
    await selectSection(editor, key);
    const selector = `input[type="color"][aria-label="${label} picker"]`;
    const picker = editor.shadowRoot!.querySelector<HTMLInputElement>(selector)!;
    const row = picker.closest(".nc-option")!;
    const help = row.querySelector(".nc-help")!;
    expect(picker.disabled).toBe(true);
    expect(help).not.toBeNull();
    picker.value = "#12ab34";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
    const toggle = sectionElement(editor).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    const enabledSection = finalizeAlert(state.alert, state.postConfirmationActions, false);
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(enabledSection);
    const option = row.querySelector("ha-switch") as HTMLElement & { checked: boolean };
    option.checked = true;
    option.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(selector)).toBe(picker);
    expect(picker.disabled).toBe(false);
    picker.value = "#12ab34";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect(editorSections.find(section => section.key === key)!.read(state)[name]).toBe("#12ab34");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(selector)).toBe(picker);
    expect(picker.disabled).toBe(true);
    expect(row.querySelector(".nc-help")).toBe(help);
    const disabledSection = finalizeAlert(state.alert, state.postConfirmationActions, false);
    picker.value = "#ff0000";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(disabledSection);
  });

  it.each(["sticky", "persistent", "alert_once"])("discards disabled Android %s=false values after save and reopen", async name => {
    const { editor, onSave } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.name = "Door";
    state.alert.notification.target = { entity_id: ["notify.phone"] };
    const section = editorSections.find(section => section.key === "android")!;
    section.write(state, { [name]: false, timeout: 0 });
    section.toggle!.set(state, false);
    await selectSection(editor, "android");
    expect(booleanSwitch(editor, name).checked).toBe(false);
    expect(booleanSwitch(editor, name).disabled).toBe(true);
    await testUser().click([...editor.shadowRoot!.querySelectorAll("ha-button")]
      .find(button => button.textContent?.trim() === "Save alert")!);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0][0];
    expect(saved).not.toHaveProperty("mobile_options");
    expect(saved.notification.options!).not.toHaveProperty(name);
    const { editor: reopened } = await mount(undefined, undefined, saved);
    await selectSection(reopened, "android");
    const control = booleanSwitch(reopened, name);
    expect(control.checked).toBe(false);
    expect(control.disabled).toBe(true);
    expect(control.closest(".nc-option")!.querySelector("ha-form")).toBeNull();
    await changeField(reopened, name, true);
    const reopenedState = (reopened as unknown as { state: EditorState }).state;
    expect(finalizeAlert(reopenedState.alert, reopenedState.postConfirmationActions, false)).toEqual(saved);
    expect(section.read(reopenedState)[name]).toBeUndefined();
    control.checked = false;
    const toggle = sectionElement(reopened).querySelector(".card-header ha-switch") as NativeSwitch;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(reopened);
    expect(booleanSwitch(reopened, name)).toBe(control);
    expect(control.checked).toBe(false);
    expect(control.disabled).toBe(false);
    expect(section.read(reopenedState)[name]).toBeUndefined();
    expect(section.read(reopenedState).timeout).toBeUndefined();
    expect(finalizeAlert(reopenedState.alert, reopenedState.postConfirmationActions, false).notification.options).toEqual({});
  });

  it.each([
    { key: "android", name: "timeout", value: 0 },
    { key: "ios", name: "sound", value: { name: "default", critical: 1, volume: 0.8 } },
  ])("discards disabled $key $name drafts after save and reopen", async ({ key, name, value }) => {
    const { editor, onSave } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.name = "Door";
    state.alert.notification.target = { entity_id: ["notify.phone"] };
    const section = editorSections.find(section => section.key === key)!;
    section.write(state, { [name]: value });
    section.toggle!.set(state, true);
    section.optional!.set(state, name, false);
    await selectSection(editor, key);
    expect(nativeForm(editor, name).schema[0].disabled).toBe(true);
    await testUser().click([...editor.shadowRoot!.querySelectorAll("ha-button")]
      .find(button => button.textContent?.trim() === "Save alert")!);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0][0];
    expect(saved).not.toHaveProperty("mobile_options");
    expect(key === "ios" ? saved.notification.options!.push ?? {} : saved.notification.options!).not.toHaveProperty(name);
    const { editor: reopened } = await mount(undefined, undefined, saved);
    await selectSection(reopened, key);
    const form = nativeForm(reopened, name);
    expect(form.schema[0].disabled).toBe(true);
    await changeField(reopened, name, "ignored");
    const reopenedState = (reopened as unknown as { state: EditorState }).state;
    expect(finalizeAlert(reopenedState.alert, reopenedState.postConfirmationActions, false)).toEqual(saved);
    const option = form.closest(".nc-option")!.querySelector("ha-switch") as HTMLElement & { checked: boolean };
    const toggle = sectionElement(reopened).querySelector(".card-header ha-switch") as NativeSwitch;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(reopened);
    option.checked = true;
    option.dispatchEvent(new Event("change"));
    await settleElement(reopened);
    expect(nativeForm(reopened, name)).toBe(form);
    expect(form.schema[0].disabled).toBeUndefined();
    expect(form.data[name]).toBeUndefined();
  });

  it("writes only the changed optional field and preserves mobile siblings and boolean label rows", async () => {
    const { editor } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.notification.options! = {
      channel: "Security", importance: "high", persistent: false,
      push: { sound: { name: "default", critical: 1, volume: 0.8 } }, custom: "keep",
    };
    state.alert.notification.message = "Door open";
    await selectSection(editor, "android");
    const section = editorSections.find(section => section.key === "android")!;
    const write = vi.spyOn(section, "write");
    const original = structuredClone(state.alert.notification.options!);
    await changeField(editor, "importance", "low");
    expect(write).toHaveBeenLastCalledWith(state, { importance: "low" });
    expect(state.alert.notification.options!).toEqual({ ...original, importance: "low" });
    const persistent = booleanSwitch(editor, "persistent");
    const row = persistent.closest(".nc-option")!;
    expect(row.querySelector("ha-form")).toBeNull();
    expect(row.lastElementChild).toBe(persistent);
    expect(row.querySelectorAll(".nc-help")).toHaveLength(1);
    expect(row.querySelector(".nc-heading")!.textContent).toBe("Persistent notification");
    expect(persistent.checked).toBe(false);
    await changeField(editor, "persistent", true);
    expect(write).toHaveBeenLastCalledWith(state, { persistent: true });
    expect(state.alert.notification.options!).toEqual({ ...original, importance: "low", persistent: true });
  });

  it.each([1100, 390])("keeps Android optional inputs and pickers inline with accessible switches at width %s", async width => {
    const { editor } = await mount();
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    const state = (editor as unknown as { state: EditorState }).state;
    Object.assign(state.alert.notification.options!, { channel: "Security", importance: "high", timeout: 0, ledColor: "#12ab34" });
    await selectSection(editor, "android");
    for (const name of ["channel", "importance", "timeout"]) {
      const form = nativeForm(editor, name);
      const row = form.closest(".nc-option-inline")!;
      expect(row.querySelector(":scope > .nc-option-input")).toBe(form.parentElement);
      expect(row.querySelector(":scope > ha-switch")).not.toBeNull();
      expect(row.querySelector(":scope > .nc-heading")).toBeNull();
      expect(form.computeLabel(form.schema[0])).toBe(state.localize(editorSections.find(section => section.key === "android")!.labels[name]));
      expect(form.parentElement!.classList.contains("nc-field-input")).toBe(true);
    }
    const picker = editor.shadowRoot!.querySelector('input[type="color"][aria-label="Channel LED color picker"]')!;
    expect(picker.parentElement!.classList.contains("nc-color-input")).toBe(true);
    expect(picker.closest(".nc-option-inline")!.querySelector(":scope > ha-switch")).not.toBeNull();
    const persistent = booleanSwitch(editor, "persistent");
    const row = persistent.closest(".nc-option-inline")!;
    expect(row.querySelector(".nc-option-input, ha-form")).toBeNull();
    expect(row.lastElementChild).toBe(persistent);
    expect(row.firstElementChild?.className).toBe("nc-heading");
    expect(row.querySelectorAll(".nc-help")).toHaveLength(1);
    expect(row.querySelector(".nc-heading > .nc-help")).not.toBeNull();
    expect(sectionElement(editor).querySelector("ha-settings-row")).toBeNull();
    const styles = (editor.constructor as typeof LitElement).styles!.toString();
    expect(styles).toMatch(/\.nc-option\s*\{\s*display: flex;\s*align-items: center;\s*flex-wrap: wrap;/);
  });

  it("saves embedded common mobile values and disabled state without changing notification siblings", async () => {
    const { editor, onSave } = await mount();
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.name = "Door";
    state.alert.notification.target = { entity_id: ["notify.phone"] };
    Object.assign(state.alert.notification.options!, {
      group: "doors", color: "#12ab34", custom: { keep: true }, push: { custom: 42 },
    });
    state.alert.notification.message = "Door open";
    await selectSection(editor, "mobile");
    expect(sectionElement(editor).dataset.section).toBe("notification");
    expect(localNavigationKeys(editor)).not.toContain("mobile");
    expect(editor.shadowRoot!.querySelectorAll("ha-card h2, ha-card h3")).toHaveLength(1);
    expect(sectionElement(editor).querySelector("h2")!.textContent).toBe("Notification");
    expect(sectionElement(editor).querySelector("h3")).toBeNull();
    const group = sectionElement(editor).querySelector('[data-embedded-section="mobile"]')!;
    expect(group.querySelector("ha-card, ha-tab-group, ha-dropdown")).toBeNull();
    expect(nativeForm(editor, "group").closest("[data-embedded-section]")).toBe(group);
    await changeField(editor, "group", "front-door");
    const toggle = group.querySelector('[aria-label="Disable Notification color"]') as HTMLElement & { checked: boolean };
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    const picker = group.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(picker.disabled).toBe(true);
    const expected = finalizeAlert(state.alert, false);
    await testUser().click([...editor.shadowRoot!.querySelectorAll("ha-button")].find(button => button.textContent?.trim() === "Save alert")!);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0]).toEqual(expected);
    expect(expected.notification.message).toBe("Door open");
    expect(expected.notification.options!).toMatchObject({ group: "front-door", custom: { keep: true }, push: { custom: 42 } });
    expect(expected.notification.options!).not.toHaveProperty("color");
    expect(expected).not.toHaveProperty("mobile_options");
    const { editor: reopened } = await mount(undefined, undefined, expected);
    await selectSection(reopened, "mobile");
    expect(nativeForm(reopened, "group").data.group).toBe("front-door");
    const reopenedPicker = reopened.shadowRoot!.querySelector<HTMLInputElement>('input[type="color"][aria-label="Notification color picker"]')!;
    expect(reopenedPicker.disabled).toBe(true);
    const restore = reopened.shadowRoot!.querySelector('[aria-label="Enable Notification color"]') as HTMLElement & { checked: boolean };
    restore.checked = true;
    restore.dispatchEvent(new Event("change"));
    await settleElement(reopened);
    expect(reopened.shadowRoot!.querySelector('input[type="color"][aria-label="Notification color picker"]')).toBe(reopenedPicker);
    expect(reopenedPicker.disabled).toBe(false);
    expect(reopenedPicker.value).toBe("#03a9f4");
  });

  it("groups automation mode, triggers, conditions and inactive controls under When", async () => {
    const { editor } = await mount();
    await selectSection(editor, "when");
    const form = nativeForm(editor, "automation_mode") as HTMLElement & {
      schema: { name: string; selector: unknown }[];
      data: Record<string, unknown>;
    };
    expect(form.schema.map(field => field.name)).toEqual(["automation_mode"]);
    expect(form.schema).toMatchSnapshot();
    expect(form.data).toEqual({ automation_mode: "parallel" });
    expect(localNavigationKeys(editor)).toEqual(children);
    expect(navigationItems(editor).map(item => item.textContent?.trim())).toMatchSnapshot();
    expect([...editor.shadowRoot!.querySelectorAll("[data-section]")].map(section => section.getAttribute("data-section")))
      .toEqual(["when"]);
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
    await selectSection(editor, "inactive");
    expect(sectionElement(editor).querySelector(".card-header h2")!.textContent).toBe("Inactive");
    const toggle = sectionElement(editor).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    const form = nativeForm(editor, "triggers") as HTMLElement & {
      schema: { name: string; selector: unknown; disabled?: boolean }[];
      data: Record<string, unknown>;
      computeLabel: (field: { name: string }) => string;
      computeHelper: (field: { name: string }) => string;
    };
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute("aria-label")).toBe("Enable Inactive");
    expect(form.schema.every(field => field.disabled)).toBe(true);
    expect(form.data).toEqual({ triggers: [], clear_notification: false });
    const clearControl = booleanSwitch(editor, "clear_notification");
    expect(clearControl.checked).toBe(false);
    expect(clearControl.disabled).toBe(true);
    expect(sectionForms(editor, "inactive").flatMap(form => form.schema.map(field => field.name)))
      .toEqual(["triggers"]);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(sectionForms(editor, "inactive").flatMap(form => form.schema)).toMatchSnapshot();
    expect(clearControl.getAttribute("aria-label")).toBe("Clear notification");
    expect(clearControl.disabled).toBe(false);
    const schema = form.schema;
    const triggers = [{ trigger: "event", event_type: "door_closed", event_data: { door: "front" }, id: "closed", alias: "Closed", enabled: false, custom: { keep: true } }];
    await changeField(editor, "triggers", triggers);
    expect(clearControl.checked).toBe(false);
    await changeField(editor, "clear_notification", clearNotification);
    expect(form.schema).toBe(schema);
    expect(form.data).toEqual({ triggers, clear_notification: clearNotification });
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.name = "Door";
    state.alert.notification.target = { entity_id: ["notify.phone"] };
    for (const enabled of [true, false, true]) {
      toggle.checked = enabled;
      toggle.dispatchEvent(new Event("change"));
      await settleElement(editor);
      expect(form.schema.every(field => Boolean(field.disabled) === !enabled)).toBe(true);
      expect(clearControl.disabled).toBe(!enabled);
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

  it("keeps Recipients standalone and embeds common options with direct platform children", () => {
    expect(editorSections.filter(section => !section.parent).map(section => section.key))
      .toEqual(["basic", "when", "recipients", "notification", "confirmation"]);
    expect(editorSections.find(section => section.key === "recipients")!.parent).toBeUndefined();
    expect(editorSections.find(section => section.key === "mobile")!.parent).toBe("notification");
    expect(editorSections.find(section => section.key === "mobile")!.embedded).toBe(true);
    expect(editorSections.find(section => section.key === "android")!.parent).toBe("notification");
    expect(editorSections.find(section => section.key === "ios")!.parent).toBe("notification");
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
    await selectSection(editor, "postSendActions");
    const section = sectionElement(editor);
    expect(section.querySelector(".card-header h2")!.textContent).toBe("Post-send actions");
    expect(section.querySelector(".card-header .nc-help")).not.toBeNull();
    const titleRow = section.querySelector(".nc-title-row > .nc-heading")!;
    expect(titleRow.children[0].tagName).toBe("H2");
    expect(titleRow.children[1]).toBe(section.querySelector(".card-header .nc-help"));
    const disabledForm = nativeForm(editor, "actions");
    expect(disabledForm).not.toBeNull();
    expect(disabledForm.schema[0].disabled).toBe(true);
    const toggle = section.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(section.querySelector(".card-header h2")!.textContent).toBe("Post-send actions");
    expect(nativeForm(editor, "actions").schema[0].disabled).toBeUndefined();
  });

  it("keeps Triggers, Conditions and global alert enablement independent", async () => {
    const { editor } = await mount();
    await selectSection(editor, "when");
    expect(editor.shadowRoot!.querySelector(".card-header h2")!.textContent).toBe("When");
    expect(sectionElement(editor).querySelector(":scope > .card-header ha-switch")).toBeNull();

    await selectSection(editor, "triggers");
    const triggerToggle = sectionElement(editor).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    expect(triggerToggle.checked).toBe(true);
    expect(triggerToggle.getAttribute("aria-label")).toBe("Disable Triggers");
    triggerToggle.checked = false;
    triggerToggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(triggerToggle.checked).toBe(false);
    expect(nativeForm(editor, "triggers").schema[0].disabled).toBe(true);

    await selectSection(editor, "conditions");
    const conditionToggle = sectionElement(editor).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    expect(conditionToggle.checked).toBe(true);
    expect(conditionToggle.getAttribute("aria-label")).toBe("Disable Conditions");
    expect((editor as unknown as { state: EditorState }).state.alert.enabled).toBe(true);
    conditionToggle.checked = false;
    conditionToggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(conditionToggle.checked).toBe(false);
    expect((editor as unknown as { state: EditorState }).state.alert.enabled).toBe(true);

    await selectSection(editor, "triggers");
    expect((sectionElement(editor).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean }).checked).toBe(false);
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
    await selectSection(editor, "notification");
    const form = nativeForm(editor, "message");
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
    await selectSection(editor, "confirmationNotification");
    const form = nativeForm(editor, "message");
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
    const help = editor.shadowRoot!.querySelector('ha-icon-button[title="More information: Basics"]')!;
    await testUser().click(help);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-dialog")!.textContent).toContain("not included in notifications");
    expect(editor.shadowRoot!.querySelector("ha-dialog")!.getAttribute("width")).toBe("small");
    expect(editor.shadowRoot!.querySelector(".nc-help-topic h3")!.textContent).toBe("Description");
    await testUser().click(editor.shadowRoot!.querySelector("ha-dialog ha-button")!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-dialog")).toBeNull();
    const form = editor.shadowRoot!.querySelector("ha-form") as HTMLElement & { computeHelper: (field: { name: string }) => string };
    expect(form.computeHelper({ name: "description" })).toContain("optional note");
  });

  it.each([1100, 390])("keeps help content fitted in a small non-fullscreen dialog at width %s", async width => {
    const { editor } = await mount();
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    await testUser().click(editor.shadowRoot!.querySelector('[title="More information: Basics"]')!);
    await settleElement(editor);
    const dialog = editor.shadowRoot!.querySelector("ha-dialog")!;
    expect(dialog.className).toBe("nc-info-dialog");
    expect(dialog.getAttribute("type")).toBe("alert");
    expect(dialog.getAttribute("width")).toBe("small");
    expect(dialog.hasAttribute("fullscreen")).toBe(false);
    expect(dialog.hasAttribute("role")).toBe(false);
    const styles = (editor.constructor as typeof LitElement).styles!.toString();
    expect(styles).toMatch(/\.nc-info-dialog\s*\{\s*--ha-dialog-width-sm: 420px;\s*--ha-dialog-width-full: calc\(100vw - 32px\);\s*--ha-dialog-min-height: auto;\s*--ha-dialog-max-height: calc\(100dvh - 48px\);/);
    for (const rule of styles.matchAll(/\.nc-(?:info-dialog|help-content|help-topic(?: p)?)\s*\{([^}]+)\}/g)) {
      expect(rule[1]).not.toContain("text-align: center");
    }
    expect(dialog.querySelector(".nc-help-topic p")!.textContent).toContain("not included in notifications");
    dialog.dispatchEvent(new Event("closed"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-dialog")).toBeNull();
  });

  it.each([1100, 390])("keeps notification template help beside the section heading, not the message editor, at width %s", async width => {
    const key = "notification";
    const name = "message";
    const label = "Message";
    const { editor } = await mount();
    resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await settleElement(editor);
    await selectSection(editor, key);
    const state = (editor as unknown as { state: EditorState }).state;
    const section = editorSections.find(section => section.key === key)!;
    const form = nativeForm(editor, name);
    expect(form.closest(".nc-field-help")).toBeNull();
    expect(form.parentElement!.querySelector(':scope > .nc-help')).toBeNull();
    expect(form.querySelector(".nc-help")).toBeNull();
    expect(form.computeLabel(form.schema[0])).toBe("");
    expect(form.computeHelper(form.schema[0])).toBeUndefined();
    expect(form.getAttribute("aria-label")).toBe(label);
    expect(form.schema[0].selector).toEqual({ template: {} });
    const heading = sectionElement(editor).querySelector(".nc-title-row > .nc-heading")!;
    const title = heading.querySelector("h2")!;
    const help = heading.querySelector<HTMLElement>(".nc-help")!;
    expect(title.textContent).toBe("Notification");
    expect([...heading.children]).toEqual([title, help]);
    expect(help.getAttribute("title")).toBe("More information: Notification");
    await testUser().click(help);
    await settleElement(editor);
    const description = state.localize(section.helpers![name]);
    expect([...editor.shadowRoot!.querySelectorAll(".nc-help-topic p")].map(topic => topic.textContent)).toEqual([description]);
    expect(editor.shadowRoot!.querySelector(".nc-help-topic h3")!.textContent).toBe(label);
    expect(description).toContain("trigger");
    expect(description).toContain("now()");
    expect(description).toContain("{{ states('sensor.temperature') }}");
    expect(description).not.toMatch(/alert_id|alert_name|alert_active|attempt|condition\./);
    await testUser().click(editor.shadowRoot!.querySelector("ha-dialog ha-button")!);
    await settleElement(editor);
    Object.assign(state.alert.notification, { title: "Door", message: "Open", options: { custom: { keep: true } } });
    await changeField(editor, "message", "{{ states('sensor.temperature') }}");
    await changeField(editor, "title", "Temperature");
    expect(state.alert.notification.title).toBe("Temperature");
    expect(state.alert.notification.message).toBe("{{ states('sensor.temperature') }}");
    expect(state.alert.notification.options!).toEqual({ custom: { keep: true } });
    const styles = (editor.constructor as typeof LitElement).styles!.toString();
    expect(styles).toMatch(/\.nc-heading\s*\{\s*display: inline-flex;\s*align-items: center;\s*gap: var\(--ha-space-1, 4px\);/);
    expect(styles).toMatch(/\.nc-option > \.nc-heading\s*\{\s*flex: 0 1 auto;/);
    expect(styles).toMatch(/\.nc-option > ha-switch\s*\{\s*flex: none;\s*margin-inline-start: auto;/);
  });

  it("shows an accessible help icon next to optional setting titles", async () => {
    const { editor } = await mount();
    await selectSection(editor, "mobile");
    await testUser().click(editor.shadowRoot!.querySelector('ha-icon-button[title="More information: Notification color"]')!);
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-dialog")!.textContent).toContain("#03A9F4");
    expect(editor.shadowRoot!.querySelectorAll(".nc-help-topic")).toHaveLength(1);
    expect(editor.shadowRoot!.querySelector(".nc-help-topic h3")).toBeNull();
  });

  it.each(["mobile", "android", "ios"])("keeps %s field help in icons without inline helpers or duplicate section topics", async key => {
    const { editor } = await mount();
    await selectSection(editor, key);
    const state = (editor as unknown as { state: EditorState }).state;
    const section = editorSections.find(section => section.key === key)!;
    const container = key === "mobile"
      ? sectionElement(editor).querySelector('[data-embedded-section="mobile"]')!
      : sectionElement(editor);
    const sectionHelp = container.querySelector(".nc-title-row .nc-help, .nc-heading > .nc-help");
    if (key === "mobile") {
      expect(container.querySelector(".nc-embedded-title .nc-heading > .nc-help")).toBeNull();
      expect(editor.shadowRoot!.querySelector('[title="More information: Mobile options"]')).toBeNull();
    } else {
      expect(sectionHelp).not.toBeNull();
      await testUser().click(sectionHelp!);
      await settleElement(editor);
      expect([...editor.shadowRoot!.querySelectorAll(".nc-help-topic p")].map(topic => topic.textContent))
        .toEqual([state.localize(section.toggle!.help!)]);
      expect(editor.shadowRoot!.querySelector(".nc-help-topic h3")).toBeNull();
      await testUser().click(editor.shadowRoot!.querySelector("ha-dialog ha-button")!);
      await settleElement(editor);
    }
    const topics = [];
    for (const field of section.schema(state)) {
      const row = [...container.querySelectorAll(".nc-option")].find(option =>
        option.querySelector<NativeForm>("ha-form")?.schema[0].name === field.name
        || option.querySelector("input")?.getAttribute("aria-label") === `${state.localize(section.labels[field.name])} picker`
        || ("boolean" in field.selector && option.querySelector("ha-switch")?.getAttribute("aria-label") === state.localize(section.labels[field.name])))!;
      const form = row.querySelector<NativeForm>("ha-form");
      if (form) expect(form.computeHelper(field)).toBeUndefined();
      const helperKey = section.helpers![field.name];
      const description = state.localize(helperKey);
      const hasHelp = description !== helperKey;
      expect(row.querySelectorAll(".nc-help")).toHaveLength(hasHelp ? 1 : 0);
      if (!hasHelp) continue;
      const label = state.localize(section.labels[field.name]);
      const help = row.querySelector<HTMLElement>(".nc-help")!;
      expect(help.getAttribute("title")).toBe(`More information: ${label}`);
      await testUser().click(help);
      await settleElement(editor);
      expect([...editor.shadowRoot!.querySelectorAll(".nc-help-topic p")].map(topic => topic.textContent)).toEqual([description]);
      expect(editor.shadowRoot!.querySelector(".nc-help-topic h3")).toBeNull();
      topics.push({ label, description });
      await testUser().click(editor.shadowRoot!.querySelector("ha-dialog ha-button")!);
      await settleElement(editor);
    }
    expect(topics).toMatchSnapshot();
  });

  it.each([
    { key: "mobile", group: "general", name: "color", label: "Notification color", disableSection: false },
    { key: "android", group: "android", name: "ledColor", label: "Channel LED color", disableSection: false },
    { key: "ios", group: "ios", name: "notification_icon_color", label: "Icon glyph color", disableSection: false },
    { key: "android", group: "android", name: "ledColor", label: "Channel LED color", disableSection: true },
    { key: "ios", group: "ios", name: "notification_icon_color", label: "Icon glyph color", disableSection: true },
  ] as const)("retains $key $name swatch through disableSection=$disableSection, finalize, reopen and reenable", async ({ key, group, name, label, disableSection }) => {
    const { editor } = await mount();
    await selectSection(editor, key);
    const state = (editor as unknown as { state: EditorState }).state;
    const selector = `input[type="color"][aria-label="${label} picker"]`;
    const picker = editor.shadowRoot!.querySelector<HTMLInputElement>(selector)!;
    const row = picker.closest(".nc-option")!;
    const option = row.querySelector("ha-switch") as HTMLElement & { checked: boolean; disabled: boolean };
    const sectionToggle = sectionElement(editor).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean } | null;
    expect(picker.disabled).toBe(true);
    expect(picker.value).toBe("#03a9f4");
    if (key !== "mobile") {
      sectionToggle!.checked = true;
      sectionToggle!.dispatchEvent(new Event("change"));
      await settleElement(editor);
      expect(picker.disabled).toBe(true);
      expect(picker.value).toBe("#03a9f4");
    }
    option.checked = true;
    option.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(picker.disabled).toBe(false);
    expect(picker.value).toBe("#03a9f4");
    expect(state.alert.notification.options![name]).toBe("#03a9f4");
    picker.value = "#12ab34";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect(picker.value).toBe("#12ab34");
    expect(state.alert.notification.options![name]).toBe("#12ab34");
    const disable = disableSection ? sectionToggle! : option;
    disable.checked = false;
    disable.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector(selector)).toBe(picker);
    expect(picker.disabled).toBe(true);
    expect(picker.value).toBe("#12ab34");
    const saved = finalizeAlert(state.alert, state.postConfirmationActions, false);
    expect(saved.notification.options!).not.toHaveProperty(name);
    if (disableSection) {
      expect(state.mobileDrafts![group]).toMatchObject({ enabled: false, values: { [name]: "#12ab34" } });
      expect(option.checked).toBe(true);
      expect(option.disabled).toBe(true);
    } else {
      expect(state.mobileDrafts![group]!.fields![name]).toEqual({ enabled: false, value: "#12ab34" });
    }
    editor.requestUpdate();
    await settleElement(editor);
    expect(picker.value).toBe("#12ab34");
    disable.checked = true;
    disable.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(picker.disabled).toBe(false);
    expect(state.alert.notification.options[name]).toBe("#12ab34");
    expect(saved).not.toHaveProperty("mobile_options");
    const { editor: reopened } = await mount(undefined, undefined, saved);
    await selectSection(reopened, key);
    const reopenedPicker = reopened.shadowRoot!.querySelector<HTMLInputElement>(selector)!;
    expect(reopenedPicker.disabled).toBe(true);
    expect(reopenedPicker.value).toBe("#03a9f4");
    const reopenedState = (reopened as unknown as { state: EditorState }).state;
    expect(finalizeAlert(reopenedState.alert, reopenedState.postConfirmationActions, false)).toEqual(saved);
    const enable = (disableSection
      ? sectionElement(reopened).querySelector(".card-header ha-switch")
      : reopenedPicker.closest(".nc-option")!.querySelector("ha-switch")) as HTMLElement & { checked: boolean };
    if (!disableSection && key !== "mobile") {
      const toggle = sectionElement(reopened).querySelector(".card-header ha-switch") as NativeSwitch;
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change"));
      await settleElement(reopened);
    }
    enable.checked = true;
    enable.dispatchEvent(new Event("change"));
    await settleElement(reopened);
    if (disableSection) {
      const option = reopenedPicker.closest(".nc-option")!.querySelector("ha-switch") as NativeSwitch;
      expect(option.checked).toBe(false);
      option.checked = true;
      option.dispatchEvent(new Event("change"));
      await settleElement(reopened);
    }
    expect(reopened.shadowRoot!.querySelector(selector)).toBe(reopenedPicker);
    expect(reopenedPicker.disabled).toBe(false);
    expect(reopenedPicker.value).toBe("#03a9f4");
    expect(reopenedState.alert.notification.options![name]).toBe("#03a9f4");
    expect(finalizeAlert(reopenedState.alert, reopenedState.postConfirmationActions, false).notification.options![name]).toBe("#03a9f4");
  });

  it("keeps the same color picker visible while disabled and ignores synthetic disabled writes", async () => {
    const { editor } = await mount();
    editor.style.setProperty("--primary-color", "#03a9f4");
    await selectSection(editor, "mobile");
    const state = (editor as unknown as { state: EditorState }).state;
    const before = finalizeAlert(state.alert, state.postConfirmationActions, false);
    const picker = editor.shadowRoot!.querySelector<HTMLInputElement>('input[type="color"][aria-label="Notification color picker"]')!;
    expect(picker.disabled).toBe(true);
    expect(picker.value).toBe("#03a9f4");
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
    picker.value = "#ff0000";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(before);
    picker.value = "#03a9f4";
    const toggle = editor.shadowRoot!.querySelector('[aria-label="Enable Notification color"]') as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('input[type="color"][aria-label="Notification color picker"]')).toBe(picker);
    expect(picker.disabled).toBe(false);
    expect(picker.value).toBe("#03a9f4");
    expect((editor as unknown as { state: EditorState }).state.alert.notification.options!.color).toBe("#03a9f4");
    picker.value = "#ff0000";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect(picker.closest(".nc-option-input")!.querySelector("ha-form")).toBeNull();
    expect(picker.value).toBe("#ff0000");
    expect((editor as unknown as { state: EditorState }).state.alert.notification.options!.color).toBe("#ff0000");
    const off = editor.shadowRoot!.querySelector('[aria-label="Disable Notification color"]') as HTMLElement & { checked: boolean };
    off.checked = false;
    off.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector('input[type="color"][aria-label="Notification color picker"]')).toBe(picker);
    expect(picker.disabled).toBe(true);
    const disabled = finalizeAlert(state.alert, state.postConfirmationActions, false);
    picker.value = "#12ab34";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect(finalizeAlert(state.alert, state.postConfirmationActions, false)).toEqual(disabled);
    expect(disabled.notification.options!).not.toHaveProperty("color");
    expect(disabled).not.toHaveProperty("mobile_options");
    expect(state.mobileDrafts?.general?.fields?.color).toEqual({ enabled: false, value: "#ff0000" });
  });

  it.each([true, false])("saves and reopens Android persistent=%s, LED color and zero timeout from native controls", async persistent => {
    const { editor, onSave } = await mount();
    editor.style.setProperty("--primary-color", "#03a9f4");
    const state = (editor as unknown as { state: EditorState }).state;
    state.alert.name = "Door";
    state.alert.notification.target = { entity_id: ["notify.phone"] };
    await selectSection(editor, "android");
    const toggle = sectionElement(editor).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);

    expect(booleanSwitch(editor, "persistent").disabled).toBe(false);
    await changeField(editor, "persistent", persistent);
    for (const name of ["ledColor", "timeout"]) {
      const section = editorSections.find(section => section.key === "android")!;
      const label = state.localize(section.labels[name]);
      const option = editor.shadowRoot!.querySelector(`[aria-label="Enable ${label}"]`) as HTMLElement & { checked: boolean };
      option.checked = true;
      option.dispatchEvent(new Event("change"));
      await settleElement(editor);
    }
    const picker = editor.shadowRoot!.querySelector('input[type="color"][aria-label="Channel LED color picker"]') as HTMLInputElement;
    expect(picker).not.toBeNull();
    expect(picker.getAttribute("aria-label")).toContain("Channel LED color");
    picker.value = "#12ab34";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect([...editor.shadowRoot!.querySelectorAll<NativeForm>("ha-form")]
      .some(form => form.schema.some(field => field.name === "ledColor"))).toBe(false);
    expect(picker.closest(".nc-option-input")!.querySelector("ha-form")).toBeNull();
    await changeField(editor, "timeout", 0);
    expect(nativeForm(editor, "timeout").className).toBe("nc-field-form nc-compact");
    expect(state.alert.notification.options!).toMatchObject({ persistent, ledColor: "#12ab34", timeout: 0 });

    const finalized = finalizeAlert(state.alert, false);
    await testUser().click([...editor.shadowRoot!.querySelectorAll("ha-button")]
      .find(button => button.textContent?.trim() === "Save alert")!);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0][0];
    expect(saved).toEqual(finalized);
    expect(parse(stringify(saved)).notification.options!).toMatchObject({ persistent, ledColor: "#12ab34", timeout: 0 });

    const { editor: reopened } = await mount(undefined, undefined, saved);
    await selectSection(reopened, "android");
    expect((sectionElement(reopened).querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean }).checked).toBe(true);
    expect(booleanSwitch(reopened, "persistent").checked).toBe(persistent);
    expect(booleanSwitch(reopened, "persistent").disabled).toBe(false);
    expect(nativeForm(reopened, "timeout").data.timeout).toBe(0);
    expect((reopened.shadowRoot!.querySelector('input[type="color"][aria-label="Channel LED color picker"]') as HTMLInputElement).value).toBe("#12ab34");
    expect([...reopened.shadowRoot!.querySelectorAll<NativeForm>("ha-form")]
      .some(form => form.schema.some(field => field.name === "ledColor"))).toBe(false);
  });

  it("keeps confirmation timeout scalar-sized and preserves sibling settings through field updates and hiding", async () => {
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
    expect(timeout.className).toBe("nc-field-form nc-compact");
    expect(nativeForm(editor, "buttons").schema.map(field => field.name)).toEqual(["buttons"]);
    expect(nativeForm(editor, "buttons").className).toBe("");
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
    expect(nativeForm(editor, "timeout").className).toBe("nc-field-form nc-compact");
    expect(nativeForm(editor, "timeout").data.timeout).toEqual({ days: 0, hours: 0, minutes: 12, seconds: 0 });
  });

  it("renders Remind every as a scalar duration and merges each reminder field without resetting siblings", async () => {
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
    expect(interval.className).toBe("nc-field-form nc-compact");
    expect(nativeForm(editor, "max_attempts").className).toBe("nc-field-form nc-compact");
    expect(nativeForm(editor, "show_attempts").className).toBe("");
    expect(sectionForms(editor)
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
  ])("retains disabled $name only in the editor session", ({ key, name, value }) => {
    const state: EditorState = {
      alert: editableAlert(draftAlertFixture()), hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    const section = editorSections.find(section => section.key === key)!;
    section.write(state, { [name]: value });
    expect(section.optional!.enabled(state, name)).toBe(true);
    section.optional!.set(state, name, false);
    const saved = finalizeAlert(state.alert, false, false);
    expect(section.read(state)[name]).toBeUndefined();
    expect(section.optional!.enabled(state, name)).toBe(false);
    const group = key === "mobile" ? "general" : key === "android" ? "android" : "ios";
    expect(saved).not.toHaveProperty("mobile_options");
    expect(state.mobileDrafts![group]!.fields![name]).toEqual({ enabled: false, value });
    section.optional!.set(state, name, true);
    expect(section.read(state)[name]).toEqual(value);
    const reopened = { ...state, alert: editableAlert(saved), mobileDrafts: undefined };
    expect(section.read(reopened)[name]).toBeUndefined();
    expect(section.optional!.enabled(reopened, name)).toBe(false);
  });

  it.each(["android", "ios"])("retains a disabled %s section only within the session", key => {
    const state: EditorState = {
      alert: editableAlert(draftAlertFixture()), hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    const section = editorSections.find(section => section.key === key)!;
    const values = key === "android" ? { channel: "Security", sticky: false } : { sound: "default", badge: 0 };
    section.write(state, values);
    section.toggle!.set(state, false);
    const saved = finalizeAlert(state.alert, false, false);
    expect(section.toggle!.get(state)).toBe(false);
    expect(section.read(state)).toMatchObject(values);
    expect(state.alert.notification.options!).not.toMatchObject(values);
    section.toggle!.set(state, true);
    expect(section.read(state)).toMatchObject(values);
    const reopened = { ...state, alert: editableAlert(saved), mobileDrafts: undefined };
    expect(section.toggle!.get(reopened)).toBe(false);
    expect(Object.values(section.read(reopened)).every(value => value === undefined)).toBe(true);
  });

  it.each(["Android", "iOS / macOS"])("keeps optional %s controls visible and disables their switches when the section is off", async title => {
    const { editor } = await mount();
    await selectSection(editor, title === "Android" ? "android" : "ios");
    const section = sectionElement(editor);
    const disabledOption = section.querySelector(".nc-option ha-switch") as HTMLElement & { disabled: boolean };
    expect(disabledOption).not.toBeNull();
    expect(disabledOption.disabled).toBe(true);
    expect(section.querySelector(".card-header h2")!.textContent).toBe(title);
    expect(section.querySelector(".card-header ha-switch")).not.toBeNull();
    const toggle = section.querySelector(".card-header ha-switch") as HTMLElement & { checked: boolean };
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect(section.querySelector(".nc-option")).not.toBeNull();
    expect((section.querySelector(".nc-option ha-switch") as HTMLElement & { disabled: boolean }).disabled).toBe(false);
    expect(section.querySelector(".card-header h2")!.textContent).toBe(title);
    expect(toggle.getAttribute("aria-label")).toBe(`Disable ${title}`);
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await settleElement(editor);
    expect((section.querySelector(".nc-option ha-switch") as HTMLElement & { disabled: boolean }).disabled).toBe(true);
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
    expect(finalizeAlert(alert, false).notification).toEqual({ target: { device_id: ["phone"] }, title: "", message: "Door open", use_default_tag: true, options: {  } });
  });

  it.each(["android", "ios"])("disables only managed %s options and restores them within the editor", key => {
    const alert = editableAlert(draftAlertFixture());
    alert.notification.options! = {
      group: "doors", sticky: false, channel: "Security",
      push: { sound: "default", badge: 0, custom: "keep" }, custom: 42,
    };
    alert.notification.message = "Door open";
    const original = structuredClone(alert.notification.options!);
    const state: EditorState = {
      alert, hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    const section = editorSections.find(section => section.key === key)!;
    expect(section.toggle!.get(state)).toBe(true);
    section.toggle!.set(state, false);
    expect(section.toggle!.get(state)).toBe(false);
    expect(alert.notification.options!).toEqual(key === "android"
      ? { group: "doors", push: original.push, custom: 42 }
      : { group: "doors", sticky: false, channel: "Security", push: { custom: "keep" }, custom: 42 });
    section.toggle!.set(state, true);
    expect(alert.notification.options!).toEqual(original);
  });

  it("keeps mobile settings in native data and preserves unknown options", () => {
    const alert = editableAlert(draftAlertFixture());
    alert.name = "Door alert";
    alert.notification.target = { device_id: ["phone"] };
    Object.assign(alert.notification, { title: "Door", message: "Open", options: { native_extra: "keep", custom: "keep", push: { custom: 42 } } });
    const state: EditorState = {
      alert, hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    editorSections.find(section => section.key === "mobile")!.write(state, { group: "doors", color: "#FF0000" });
    editorSections.find(section => section.key === "android")!.write(state, { channel: "Security", importance: "high", persistent: true, sticky: true });
    editorSections.find(section => section.key === "ios")!.write(state, { "interruption-level": "time-sensitive", sound: "default", badge: 0 });
    expect(alert.notification.options!).toEqual({
      native_extra: "keep", custom: "keep", group: "doors", color: "#FF0000",
      channel: "Security", importance: "high", persistent: true, sticky: true,
      push: { custom: 42, "interruption-level": "time-sensitive", sound: "default", badge: 0 },
    });
    editorSections.find(section => section.key === "ios")!.write(state, { sound: "" });
    expect(alert.notification.options!.push).toEqual({ custom: 42, "interruption-level": "time-sensitive", badge: 0 });
    expect(finalizeAlert(alert, false).notification).toMatchObject({ title: "Door", message: "Open", options: { native_extra: "keep", persistent: true } });
    expect(alert.notification.options!).not.toHaveProperty("title");
    expect(alert.notification.options!).not.toHaveProperty("message");
  });

  it("preserves structured iOS critical sounds when changing another option", () => {
    const alert = editableAlert(draftAlertFixture());
    const sound = { name: "default", critical: 1, volume: 0.8 };
    alert.notification.options! = { push: { sound } };
    const state: EditorState = {
      alert, hass: homeAssistantFixture(), localize: () => "", postConfirmationActions: false, users: [],
    };
    const section = editorSections.find(section => section.key === "ios")!;
    expect(section.schema(state).find(field => field.name === "sound")!.selector).toEqual({ object: {} });
    section.write(state, { ...section.read(state), subtitle: "Door" });
    expect(alert.notification.options!.push).toEqual({ sound });
  });

  it.each([
    { platforms: ["android"], unknown: false, label: "Android" },
    { platforms: ["ios"], unknown: false, label: "iOS / macOS" },
    { platforms: ["android", "ios"], unknown: true, label: "Android, iOS / macOS, Unknown" },
  ])("shows detected recipient platforms: $label", async ({ platforms, unknown, label }) => {
    const sendMessagePromise = vi.fn().mockResolvedValue({ platforms, unknown });
    const { editor } = await mount(undefined, sendMessagePromise);
    await selectSection(editor, "recipients");
    expect(sectionElement(editor).querySelector('[role="status"]')?.textContent).toBe(label);
    expect(editor.shadowRoot!.textContent).not.toContain("Recipient platforms");
    for (const platform of platforms) {
      expect(localNavigationKeys(editor)).toContain(platform);
      expect(sectionElement(editor, platform)).toBeNull();
      expect(editor.shadowRoot!.textContent).not.toContain("recipients selected");
    }
    expect(sendMessagePromise).toHaveBeenCalledWith({ type: "ha_notifications/mobile_platforms", target: {} });
    const form = nativeForm(editor, "target");
    form.dispatchEvent(new CustomEvent("value-changed", { detail: { value: { target: { device_id: ["phone"] } } } }));
    await settleElement(editor);
    expect(sendMessagePromise).toHaveBeenLastCalledWith({ type: "ha_notifications/mobile_platforms", target: { device_id: ["phone"] } });
    await selectSection(editor, "mobile");
    expect(sectionElement(editor).querySelector('[role="status"]')).toBeNull();
    expect(localNavigationKeys(editor).includes("android")).toBe(unknown || platforms.includes("android"));
    expect(localNavigationKeys(editor).includes("ios")).toBe(unknown || platforms.includes("ios"));
  });

  it("keeps both platform sections available when detection fails", async () => {
    const { editor } = await mount(undefined, vi.fn().mockRejectedValue(new Error("Offline")));
    await selectSection(editor, "mobile");
    expect(sectionElement(editor).querySelector('[role="status"]')).toBeNull();
    expect(localNavigationKeys(editor)).toContain("android");
    expect(localNavigationKeys(editor)).toContain("ios");
    await selectSection(editor, "recipients");
    expect(sectionElement(editor).querySelector('[role="status"]')!.textContent).toBe("Unknown");
  });

  it.each([
    { key: "android", title: "Android" },
    { key: "ios", title: "iOS / macOS" },
  ])("hides unconfigured unavailable $title local navigation", async ({ key }) => {
    const sendMessagePromise = vi.fn().mockResolvedValue({ platforms: [], unknown: false });
    const { editor } = await mount(undefined, sendMessagePromise);
    await vi.waitFor(() => expect(sendMessagePromise).toHaveBeenCalledOnce());
    await selectSection(editor, "mobile");
    expect(localNavigationKeys(editor)).not.toContain(key);
    expect(sectionElement(editor, key)).toBeNull();
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

  it.each([
    { key: "triggers", name: "triggers", tag: "ha-selector-trigger" },
    { key: "conditions", name: "conditions", tag: "ha-selector-condition" },
    { key: "postSendActions", name: "actions", tag: "ha-selector-action" },
  ])("leaves code editors inside $tag untouched on insertion and rerender", async ({ key, name, tag }) => {
    const { editor } = await mount();
    await selectSection(editor, key);
    const formRoot = nativeForm(editor, name).attachShadow({ mode: "open" });
    const selector = document.createElement(tag);
    const selectorRoot = selector.attachShadow({ mode: "open" });
    const codeEditor = document.createElement("ha-code-editor");
    const dom = document.createElement("div");
    const scrollDOM = document.createElement("div");
    const contentDOM = document.createElement("div");
    const gutter = document.createElement("div");
    gutter.className = "cm-gutters";
    dom.append(scrollDOM, contentDOM, gutter);
    const readView = vi.fn(() => ({ dom, scrollDOM, contentDOM }));
    const readUpdate = vi.fn(() => Promise.resolve());
    Object.defineProperties(codeEditor, {
      codemirror: { get: readView },
      updateComplete: { get: readUpdate },
    });
    selectorRoot.append(codeEditor);
    formRoot.append(selector);

    const directCodeEditor = document.createElement("ha-code-editor");
    const directDom = document.createElement("div");
    Object.assign(directCodeEditor, { codemirror: { dom: directDom } });
    formRoot.append(directCodeEditor);
    await vi.waitFor(() => expect(directDom.style.minHeight).toBe("420px"));

    const expectUntouched = () => {
      expect(readView).not.toHaveBeenCalled();
      expect(readUpdate).not.toHaveBeenCalled();
      for (const element of [dom, scrollDOM, contentDOM, gutter]) {
        expect(element.style.cssText).toBe("");
      }
    };
    expectUntouched();
    editor.requestUpdate();
    await settleElement(editor);
    expectUntouched();
  });

  it("preserves native panel spacing on insertion, expansion and nested expansion", async () => {
    const { editor } = await mount();
    const form = editor.shadowRoot!.querySelector("ha-form")!;
    const panel = document.createElement("ha-expansion-panel");
    panel.style.setProperty("--expansion-panel-content-padding", "0");
    form.attachShadow({ mode: "open" }).append(panel);
    const toggle = (expanded: boolean) => panel.dispatchEvent(new CustomEvent("expanded-will-change", {
      detail: { expanded },
      bubbles: true,
      composed: true,
    }));

    toggle(true);
    expect(panel.style.getPropertyValue("--expansion-panel-content-padding")).toBe("0");
    const nestedPanel = document.createElement("ha-expansion-panel");
    panel.attachShadow({ mode: "open" }).append(nestedPanel);
    nestedPanel.dispatchEvent(new CustomEvent("expanded-will-change", {
      detail: { expanded: true },
      bubbles: true,
      composed: true,
    }));
    expect(nestedPanel.style.getPropertyValue("--expansion-panel-content-padding")).toBe("");
    expect(panel.style.getPropertyValue("--expansion-panel-content-padding")).toBe("0");
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
    await selectSection(editor, "triggers");
    const form = nativeForm(editor, "triggers") as HTMLElement & {
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