// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import type { FeatureSwitch, HelpIcon } from "../../frontend/editor/setting-row.js";
import { openEditor } from "../../frontend/editor/index.js";
import { finalizeAlert, type EditableAlert } from "../../frontend/editor/alert-model.js";
import {
  editorSections, findSection, isFieldEnabled, isSectionEnabled, readField, sectionStatus, setFieldEnabled,
  setSectionEnabled, writeField, type EditorField,
} from "../../frontend/editor/sections.js";
import { createLocalizer, optionalTranslation } from "../../frontend/localize.js";
import {
  cleanupTestDom, draftAlertFixture, editableAlert, editorRoot, homeAssistantFixture, settleElement,
  settingRowHeading, settingRowSlot, testUser,
} from "./conftest.js";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanupTestDom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type NativeForm = HTMLElement & {
  schema: { name: string; selector: Record<string, unknown>; disabled?: boolean }[];
  data: Record<string, unknown>;
  computeLabel: () => string;
};
type NativeSwitch = HTMLElement & { checked: boolean };

function draft(): EditableAlert {
  return editableAlert(draftAlertFixture());
}

function field(sectionKey: string, name: string, alert = draft()): EditorField {
  return findSection(sectionKey).fields(alert).find(item => item.name === name)!;
}

function write(alert: EditableAlert, sectionKey: string, name: string, value: unknown): void {
  writeField(alert, findSection(sectionKey), field(sectionKey, name, alert), value);
}

async function mount(options: {
  alert?: EditableAlert;
  callWS?: ReturnType<typeof vi.fn>;
  onSave?: ReturnType<typeof vi.fn>;
  loadFragmentTranslation?: ReturnType<typeof vi.fn>;
} = {}) {
  const root = editorRoot();
  const onSave = options.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onClosed = vi.fn();
  const onValidateAlert = vi.fn().mockResolvedValue(undefined);
  openEditor({
    root,
    hass: homeAssistantFixture({
      callWS: options.callWS ?? vi.fn().mockResolvedValue({ platforms: [], unknown: true }),
      loadFragmentTranslation: options.loadFragmentTranslation ?? vi.fn().mockResolvedValue(undefined),
    }),
    alert: options.alert ?? draftAlertFixture(),
    onSave,
    onClosed,
    onValidateAlert,
  });
  const editor = root.querySelector<LitElement>("ha-notifications-alert-editor")!;
  await settleElement(editor);
  return { editor, onSave, onClosed, onValidateAlert };
}

async function select(editor: LitElement, key: string): Promise<void> {
  (editor as unknown as { selected: string }).selected = key;
  await settleElement(editor);
}

function forms(editor: LitElement): NativeForm[] {
  return [...editor.shadowRoot!.querySelectorAll<NativeForm>("[data-section] ha-form")];
}

function form(editor: LitElement, name: string): NativeForm {
  const matches = forms(editor).filter(item => item.schema[0].name === name);
  expect(matches).toHaveLength(1);
  return matches[0];
}

async function changeForm(editor: LitElement, name: string, value: unknown): Promise<void> {
  form(editor, name).dispatchEvent(new CustomEvent("value-changed", { detail: { value: { [name]: value } } }));
  await settleElement(editor);
}

function row(editor: LitElement, name: string): HTMLElement {
  return editor.shadowRoot!.querySelector<HTMLElement>(`ha-notifications-setting-row[data-editor-field="${name}"]`)!;
}

function featureSwitch(container: Element): NativeSwitch {
  const component = container as FeatureSwitch;
  component.performUpdate();
  return component.shadowRoot!.querySelector<NativeSwitch>("ha-switch")!;
}

async function toggle(editor: LitElement, control: NativeSwitch, checked: boolean): Promise<void> {
  control.checked = checked;
  control.dispatchEvent(new Event("change"));
  await settleElement(editor);
}

function sectionSwitch(editor: LitElement): NativeSwitch {
  return featureSwitch(editor.shadowRoot!.querySelector(".card-header ha-notifications-feature-switch")!);
}

function saveButton(editor: LitElement): HTMLElement {
  return [...editor.shadowRoot!.querySelectorAll<HTMLElement>("ha-button")]
    .find(button => button.textContent?.trim() === "Save alert")!;
}

function navigationLabels(editor: LitElement): string[] {
  return [...editor.shadowRoot!.querySelectorAll(".nc-nav button")].map(button => button.textContent!.trim());
}

async function openHelp(editor: LitElement, help: Element): Promise<{ title: string; topics: string[] }> {
  const icon = help as HelpIcon;
  await settleElement(icon);
  await testUser().click(icon.shadowRoot!.querySelector("ha-icon-button")!);
  await settleElement(editor);
  const dialog = editor.shadowRoot!.querySelector<HTMLElement & { headerTitle: string }>("ha-dialog.nc-info-dialog")!;
  return {
    title: dialog.headerTitle,
    topics: [...dialog.querySelectorAll(".nc-help-topic")].map(topic => topic.textContent!.replace(/\s+/g, " ").trim()),
  };
}

describe("section data bindings", () => {
  it("declares a translated label for every section and field", () => {
    const t = createLocalizer(undefined);
    const alert = draft();
    alert.monitor.conditions.interval.enabled = true;
    alert.confirmation.reminders.forget_after.enabled = true;
    for (const section of editorSections) {
      expect(optionalTranslation(t, `editor.${section.key}.label`), section.key).toBeDefined();
      for (const item of section.fields(alert)) {
        expect(optionalTranslation(t, `editor.${section.key}.${item.name}.label`), `${section.key}.${item.name}`).toBeDefined();
      }
    }
  });

  it("reads every field without creating optional configuration", () => {
    const alert = draft();
    delete alert.post_send_actions;
    delete alert.notification.option_controls;
    const original = structuredClone(alert);
    for (const section of editorSections) {
      for (const item of section.fields(alert)) readField(alert, item);
      isSectionEnabled(alert, section);
      sectionStatus(alert, section);
    }
    expect(alert).toEqual(original);
  });

  it.each([true, false])("writes definite section flags at their canonical paths with enabled=%s", enabled => {
    const alert = draft();
    delete alert.post_send_actions;
    for (const key of ["triggers", "conditions", "inactive", "postSendActions", "confirmation", "reminder",
      "confirmationNotification", "postConfirmationActions", "android", "ios"]) {
      setSectionEnabled(alert, findSection(key), enabled);
      expect(isSectionEnabled(alert, findSection(key)), key).toBe(enabled);
    }
    expect(alert.post_send_actions).toEqual({ enabled });
    expect(alert.confirmation.actions).toEqual({ enabled, items: [] });
    expect(alert.confirmation.notification.enabled).toBe(enabled);
    expect(alert.notification.option_controls?.android?.enabled).toBe(enabled);
    expect(alert.notification.option_controls?.ios?.enabled).toBe(enabled);
  });

  it("combines child status with every ancestor switch without changing child flags", () => {
    const alert = draft();
    alert.confirmation.reminders.enabled = true;
    alert.confirmation.notification.enabled = true;
    alert.confirmation.actions.enabled = true;
    const children = ["reminder", "confirmationNotification", "postConfirmationActions"].map(findSection);
    expect(children.map(child => sectionStatus(alert, child))).toEqual([false, false, false]);
    setSectionEnabled(alert, findSection("confirmation"), true);
    expect(children.map(child => sectionStatus(alert, child))).toEqual([true, true, true]);
    expect(sectionStatus(alert, findSection("when"))).toBeUndefined();
    alert.monitor.triggers.enabled = false;
    expect(sectionStatus(alert, findSection("triggers"))).toBe(false);
  });

  it("converts durations, list defaults and recipient users at the binding boundary", () => {
    const alert = draft();
    alert.notification.target = { user_id: ["user-1"], entity_id: ["notify.old"] };
    alert.monitor.conditions.interval.enabled = true;
    write(alert, "conditions", "interval", { hours: 2 });
    write(alert, "triggers", "items", undefined);
    write(alert, "recipients", "target", { device_id: ["phone"] });
    expect(alert.monitor.conditions.interval.value).toBe(7200);
    expect(alert.monitor.triggers.items).toEqual([]);
    expect(alert.notification.target).toEqual({ device_id: ["phone"], user_id: ["user-1"] });
    expect(readField(alert, field("recipients", "target", alert))).toEqual({ device_id: ["phone"] });
    expect(readField(alert, field("conditions", "interval", alert))).toEqual({ days: 0, hours: 2, minutes: 0, seconds: 0 });
  });

  it("forces parallel automation mode while conditions are active", () => {
    const alert = draft();
    alert.monitor.automation_mode = "single";
    alert.monitor.conditions.items = [{ condition: "state", entity_id: "binary_sensor.door", state: "on" }];
    const mode = field("when", "automation_mode", alert);
    expect(mode.disabled).toBe(true);
    expect(readField(alert, mode)).toBe("parallel");
    writeField(alert, findSection("when"), mode, "queued");
    expect(alert.monitor.automation_mode).toBe("single");
  });

  it("removes cleared native options, prunes empty push options and keeps unknown extras", () => {
    const alert = draft();
    alert.notification.options = { custom: "keep", push: { sound: "default" } };
    write(alert, "ios", "badge", 3);
    write(alert, "ios", "sound", "");
    expect(alert.notification.options).toEqual({ custom: "keep", push: { badge: 3 } });
    write(alert, "ios", "badge", undefined);
    expect(alert.notification.options).toEqual({ custom: "keep" });
    write(alert, "android", "sticky", false);
    expect(alert.notification.options).toEqual({ custom: "keep", sticky: false });
  });

  it("never enables a group or field by typing a value", () => {
    const alert = draft();
    write(alert, "android", "channel", "Alarm");
    expect(alert.notification.options).toEqual({ channel: "Alarm" });
    expect(isSectionEnabled(alert, findSection("android"))).toBe(false);
    expect(isFieldEnabled(alert, findSection("android"), field("android", "channel", alert))).toBe(false);
    setFieldEnabled(alert, findSection("android"), field("android", "channel", alert), true);
    expect(isSectionEnabled(alert, findSection("android"))).toBe(false);
  });

  it("keeps structured iOS critical sounds editable as objects", () => {
    const alert = draft();
    alert.notification.options = { push: { sound: { name: "default", critical: 1 } } };
    expect(field("ios", "sound", alert).selector).toEqual({ object: {} });
  });

  it.each(["android", "ios"] as const)("infers %s enablement from values and snapshots field flags when disabled", key => {
    const alert = draft();
    alert.notification.options = key === "android" ? { sticky: false, timeout: 0 } : { push: { sound: "default", badge: 0 } };
    const section = findSection(key);
    expect(isSectionEnabled(alert, section)).toBe(true);
    expect(alert.notification).not.toHaveProperty("option_controls");
    setSectionEnabled(alert, section, false);
    const control = alert.notification.option_controls![key]!;
    expect(control.enabled).toBe(false);
    expect(control.fields).toMatchObject(key === "android"
      ? { sticky: true, timeout: true, channel: false }
      : { "push.sound": true, "push.badge": true, subtitle: false });
    const fields = structuredClone(control.fields);
    setSectionEnabled(alert, section, true);
    expect(control.fields).toEqual(fields);
  });

  it("toggles option fields without touching their configured values", () => {
    const alert = draft();
    alert.notification.options = { group: "doors" };
    const section = findSection("mobile");
    const group = field("mobile", "group", alert);
    expect(isFieldEnabled(alert, section, group)).toBe(true);
    setFieldEnabled(alert, section, group, false);
    expect(isFieldEnabled(alert, section, group)).toBe(false);
    expect(alert.notification.option_controls?.mobile).toEqual({
      enabled: true, fields: { group: false, color: false, notification_icon: false, icon_url: false },
    });
    write(alert, "mobile", "group", "windows");
    expect(isFieldEnabled(alert, section, group)).toBe(false);
    expect(alert.notification.options).toEqual({ group: "windows" });
  });

  it("preserves confirmation child flags and values through a disabled save and reopen", () => {
    const alert = draft();
    alert.confirmation.enabled = true;
    alert.confirmation.actions = { enabled: true, items: [{ action: "script.after_confirmation" }] };
    alert.confirmation.notification.enabled = true;
    const original = structuredClone(alert.confirmation);
    setSectionEnabled(alert, findSection("confirmation"), false);
    const reopened = editableAlert(finalizeAlert(alert, false));
    expect(reopened.confirmation).toEqual({ ...original, enabled: false });
  });
});

describe("alert editor", () => {
  it("renders navigation from the section list and embeds common mobile options", async () => {
    const { editor } = await mount();
    expect(navigationLabels(editor)).toEqual([
      "Basics", "When", "Triggers", "Conditions", "Inactive", "Recipients", "Notification", "Post-send actions",
      "Android", "iOS / macOS", "Confirmation", "Reminder policy", "Notify recipients when confirmed", "Post-confirmation actions",
    ]);
    await select(editor, "notification");
    expect(editor.shadowRoot!.querySelector("[data-embedded-section]")!.getAttribute("data-embedded-section")).toBe("mobile");
    expect(forms(editor).map(item => item.schema[0].name)).toEqual([
      "title", "message", "group", "notification_icon", "icon_url",
    ]);
  });

  it("edits hex colors with a native picker and seeds the theme color when enabled", async () => {
    const { editor } = await mount();
    editor.style.setProperty("--primary-color", "#112233");
    await select(editor, "notification");
    const colorRow = row(editor, "color");
    const picker = colorRow.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(picker.getAttribute("aria-label")).toBe("Notification color");
    const alert = (editor as unknown as { alert: EditableAlert }).alert;
    await toggle(editor, featureSwitch(colorRow.querySelector("ha-notifications-feature-switch")!), true);
    expect(alert.notification.options.color).toBe("#112233");
    picker.value = "#445566";
    picker.dispatchEvent(new Event("input"));
    await settleElement(editor);
    expect(alert.notification.options.color).toBe("#445566");
    expect(alert.notification.option_controls?.mobile?.fields.color).toBe(true);
  });

  it("writes form and switch edits to the draft and marks it dirty", async () => {
    const { editor } = await mount();
    await changeForm(editor, "name", "Door alert");
    expect(form(editor, "name").data).toEqual({ name: "Door alert" });
    expect(editor.shadowRoot!.querySelector("[slot=title]")!.textContent).toBe("Door alert");
    expect(editor.shadowRoot!.querySelector(".nc-dirty")!.textContent).toBe("Unsaved changes");
    await select(editor, "conditions");
    expect(forms(editor).some(item => item.schema[0].name === "interval")).toBe(false);
    await toggle(editor, row(editor, "interval_enabled").querySelector<NativeSwitch>("ha-switch")!, true);
    expect(form(editor, "interval").data.interval).toEqual({ days: 0, hours: 12, minutes: 0, seconds: 0 });
  });

  it("keeps one-field schemas stable across rerenders and localizes select options", async () => {
    const { editor } = await mount();
    await select(editor, "when");
    const schema = form(editor, "automation_mode").schema;
    expect(schema[0].selector).toEqual({ select: { mode: "dropdown", options: [
      { value: "parallel", label: "Parallel (run triggers independently)" },
      { value: "single", label: "Single (ignore new triggers while running)" },
      { value: "restart", label: "Restart (cancel and start again)" },
      { value: "queued", label: "Queued (run triggers in order)" },
    ] } });
    editor.requestUpdate();
    await settleElement(editor);
    expect(form(editor, "automation_mode").schema).toBe(schema);
  });

  it("toggles sections and option fields through feature switches", async () => {
    const { editor } = await mount();
    await select(editor, "android");
    await toggle(editor, sectionSwitch(editor), true);
    const channel = row(editor, "channel");
    const channelSwitch = featureSwitch(channel.querySelector("ha-notifications-feature-switch")!);
    expect(channelSwitch.checked).toBe(false);
    await toggle(editor, channelSwitch, true);
    const alert = (editor as unknown as { alert: EditableAlert }).alert;
    expect(alert.notification.option_controls?.android).toMatchObject({ enabled: true, fields: { channel: true } });
  });

  it("puts boolean help after the label and keeps the switch separate", async () => {
    const { editor } = await mount();
    await select(editor, "notification");
    const tag = row(editor, "use_default_tag");
    const heading = settingRowHeading(tag);
    expect([...heading.querySelectorAll("slot")].map(slot => slot.name)).toEqual(["label", "help"]);
    expect(settingRowSlot(tag, "toggle").closest(".nc-heading")).toBeNull();
    expect(settingRowSlot(tag, "label").assignedElements()[0].textContent).toBe("Replace previous notifications");
    expect(settingRowSlot(tag, "help").assignedElements()[0].tagName).toBe("HA-NOTIFICATIONS-HELP-ICON");
    expect(settingRowSlot(tag, "toggle").assignedElements()[0].tagName).toBe("HA-SWITCH");
  });

  it("collects section and large-editor help in the heading dialog", async () => {
    const { editor } = await mount();
    await select(editor, "triggers");
    const help = await openHelp(editor, editor.shadowRoot!.querySelector(".card-header ha-notifications-help-icon")!);
    expect(help.title).toBe("Triggers");
    expect(help.topics).toHaveLength(2);
    expect(help.topics[0]).toMatch(/^Controls custom triggers/);
    expect(help.topics[1]).toMatch(/^Triggers Optional\. Use the native Home Assistant trigger editor/);
    expect(form(editor, "items").computeLabel()).toBe("");
    expect(form(editor, "items").getAttribute("aria-label")).toBe("Triggers");
  });

  it("shows scalar help beside the field and helper placeholders inside text fields", async () => {
    const { editor } = await mount();
    expect(row(editor, "description").querySelector("ha-notifications-help-icon")).toBeNull();
    expect(form(editor, "description").schema[0]).toMatchObject({
      selector: { text: { multiline: true } }, default: expect.stringMatching(/^An optional note/),
    });
    expect(row(editor, "name").querySelector(".nc-field-input")!.classList.contains("nc-wide")).toBe(true);
    await select(editor, "when");
    const help = await openHelp(editor, row(editor, "automation_mode").querySelector("ha-notifications-help-icon")!);
    expect(help.title).toBe("Automation mode");
    expect(help.topics[0]).toMatch(/^Parallel is usually/);
  });

  it("hides platform sections nobody receives unless they are configured", async () => {
    const alert = draftAlertFixture();
    alert.notification.options = { channel: "Security" };
    alert.notification.option_controls = { android: { enabled: false, fields: { channel: true } } };
    const { editor } = await mount({ alert, callWS: vi.fn().mockResolvedValue({ platforms: ["ios"], unknown: false }) });
    await settleElement(editor);
    expect(navigationLabels(editor)).toContain("Android");
    await select(editor, "android");
    await changeForm(editor, "channel", "");
    expect(navigationLabels(editor)).not.toContain("Android");
    expect(editor.shadowRoot!.querySelector("[data-section]")!.getAttribute("data-section")).toBe("notification");
  });

  it("keeps both platform sections when detection fails and reports it in Recipients", async () => {
    const { editor } = await mount({ callWS: vi.fn().mockRejectedValue(new Error("offline")) });
    await select(editor, "recipients");
    expect(navigationLabels(editor)).toEqual(expect.arrayContaining(["Android", "iOS / macOS"]));
    expect(editor.shadowRoot!.querySelector(".nc-platform-summary")!.textContent).toBe("Unknown");
  });

  it("saves once while pending, then closes", async () => {
    let resolve!: () => void;
    const onSave = vi.fn().mockReturnValue(new Promise<void>(done => { resolve = done; }));
    const { editor, onClosed } = await mount({ onSave });
    await changeForm(editor, "name", "Door alert");
    await select(editor, "recipients");
    await changeForm(editor, "target", { entity_id: ["notify.phone"] });
    saveButton(editor).click();
    saveButton(editor).click();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: "Door alert", notification: { target: { entity_id: ["notify.phone"] } } });
    resolve();
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledOnce());
    expect(editor.isConnected).toBe(false);
  });

  it("keeps the draft open with a snackbar when saving fails", async () => {
    const { editor, onClosed } = await mount({ onSave: vi.fn().mockRejectedValue(new Error("Save unavailable")) });
    const notifications = vi.fn();
    editor.addEventListener("hass-notification", notifications);
    saveButton(editor).click();
    await settleElement(editor);
    expect((notifications.mock.calls[0][0] as CustomEvent).detail.message).toBe("Name is required.");
    await changeForm(editor, "name", "Door alert");
    await select(editor, "recipients");
    await changeForm(editor, "target", { entity_id: ["notify.phone"] });
    saveButton(editor).click();
    await vi.waitFor(() => expect(notifications).toHaveBeenCalledTimes(2));
    expect((notifications.mock.calls[1][0] as CustomEvent).detail.message).toBe("Save unavailable");
    expect(editor.isConnected).toBe(true);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("validates the current draft and reports the section result", async () => {
    const { editor, onValidateAlert } = await mount();
    await select(editor, "conditions");
    const notifications = vi.fn();
    editor.addEventListener("hass-notification", notifications);
    const menu = editor.shadowRoot!.querySelector<HTMLElement & { items: { label: string; action: () => void }[] }>(
      ".card-header ha-icon-overflow-menu")!;
    expect(menu.items.map(item => item.label)).toEqual(["Validate conditions"]);
    menu.items[0].action();
    await vi.waitFor(() => expect(notifications).toHaveBeenCalledOnce());
    expect(onValidateAlert).toHaveBeenCalledOnce();
    expect((notifications.mock.calls[0][0] as CustomEvent).detail.message).toBe("Condition is valid.");
  });

  it("previews YAML and confirms before discarding a dirty draft", async () => {
    const { editor, onClosed } = await mount();
    await changeForm(editor, "name", "Preview");
    const menu = editor.shadowRoot!.querySelector<HTMLElement & { items: { action: () => void }[] }>(
      'div[slot="actionItems"] ha-icon-overflow-menu')!;
    menu.items[0].action();
    await settleElement(editor);
    const yaml = editor.shadowRoot!.querySelector<HTMLElement & { defaultValue: { name: string } }>("ha-yaml-editor")!;
    expect(yaml.defaultValue.name).toBe("Preview");
    editor.shadowRoot!.querySelector("ha-dialog")!.dispatchEvent(new Event("closed"));
    await settleElement(editor);
    editor.shadowRoot!.querySelector<HTMLElement>('ha-icon-button[slot="navigationIcon"]')!.click();
    await settleElement(editor);
    expect(editor.shadowRoot!.querySelector("ha-dialog")!.textContent).toContain("Leave without saving?");
    expect(onClosed).not.toHaveBeenCalled();
    [...editor.shadowRoot!.querySelectorAll<HTMLElement>("ha-button")]
      .find(button => button.textContent?.trim() === "Discard changes")!.click();
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it("loads HA configuration translations and reports loading errors", async () => {
    const loadFragmentTranslation = vi.fn().mockRejectedValue(new Error("translations offline"));
    const notifications = vi.fn();
    document.addEventListener("hass-notification", notifications);
    await mount({ loadFragmentTranslation });
    await vi.waitFor(() => expect(notifications).toHaveBeenCalledOnce());
    document.removeEventListener("hass-notification", notifications);
    expect(loadFragmentTranslation).toHaveBeenCalledWith("config");
    expect((notifications.mock.calls[0][0] as CustomEvent).detail.message).toBe("translations offline");
  });
});
