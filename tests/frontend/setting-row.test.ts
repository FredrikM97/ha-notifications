// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { html } from "lit";
import { mdiInformationOutline } from "@mdi/js";
import { FeatureSwitch, HelpIcon, type EnabledChangedDetail, type HelpRequestDetail, type SettingRow } from "../../frontend/editor/setting-row.js";
import { cleanupTestDom, renderTemplate, settleElement, settingRowHeading, settingRowSlot, testUser } from "./conftest.js";

afterEach(cleanupTestDom);

describe("feature switch", () => {
  it.each([true, false])("renders enabled=%s and emits a composed value without owning configuration", async enabled => {
    const changed = vi.fn();
    const container = renderTemplate(html`<ha-notifications-feature-switch .enabled=${enabled}
      .label=${"Enable Android"}></ha-notifications-feature-switch>`);
    container.addEventListener("enabled-changed", changed);
    const component = container.querySelector<FeatureSwitch>("ha-notifications-feature-switch")!;
    await settleElement(component);
    const control = component.shadowRoot!.querySelector<HTMLElement & { checked: boolean; disabled: boolean }>("ha-switch")!;
    expect(control.checked).toBe(enabled);
    expect(control.disabled).toBe(false);
    expect(control.getAttribute("aria-label")).toBe("Enable Android");
    control.checked = !enabled;
    control.dispatchEvent(new Event("change"));
    expect(changed).toHaveBeenCalledOnce();
    const event = changed.mock.calls[0][0] as CustomEvent<EnabledChangedDetail>;
    expect(event.detail).toEqual({ enabled: !enabled });
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(event.target).toBe(component);
    expect(component.enabled).toBe(enabled);
    component.enabled = !enabled;
    component.label = "Disable Android";
    await settleElement(component);
    expect(component.shadowRoot!.querySelector("ha-switch")).toBe(control);
    expect(control.checked).toBe(!enabled);
    expect(control.getAttribute("aria-label")).toBe("Disable Android");
    expect(changed).toHaveBeenCalledOnce();
  });
});

describe("setting row", () => {
  it("slots an ordinary native form without rebuilding it or adding a visible heading", async () => {
    const changed = vi.fn();
    const data = { title: "Door" };
    const schema = [{ name: "title", selector: { text: {} } }];
    const container = renderTemplate(html`<ha-notifications-setting-row>
      <ha-form aria-label="Title" .data=${data} .schema=${schema} @value-changed=${changed}></ha-form>
      <ha-switch slot="toggle" aria-label="Enable title"></ha-switch>
    </ha-notifications-setting-row>`);
    const row = container.querySelector<SettingRow>("ha-notifications-setting-row")!;
    await settleElement(row);
    const form = row.querySelector<HTMLElement & { data: unknown; schema: unknown }>("ha-form")!;
    const slot = row.shadowRoot!.querySelector<HTMLSlotElement>("slot:not([name])")!;
    expect(slot.assignedElements()).toEqual([form]);
    expect(form.data).toBe(data);
    expect(form.schema).toBe(schema);
    expect(form.parentElement).toBe(row);
    expect(row.shadowRoot!.querySelector("ha-form, ha-switch")).toBeNull();
    expect(settingRowHeading(row).hidden).toBe(true);
    const event = new CustomEvent("value-changed", { detail: { value: { title: "Window" } } });
    form.dispatchEvent(event);
    expect(changed).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("places label and help before a separate boolean toggle and preserves parent events", async () => {
    const changed = vi.fn();
    const helpRequested = vi.fn();
    const entries = [{ text: "Keep the notification visible." }];
    const container = renderTemplate(html`<ha-notifications-setting-row @help-request=${helpRequested}>
      <span slot="label">Persistent notification</span>
      <ha-notifications-help-icon slot="help" .heading=${"Persistent notification"}
        .moreInfo=${"More information"} .entries=${entries}></ha-notifications-help-icon>
      <ha-switch slot="toggle" aria-label="Persistent notification" .checked=${true} .disabled=${false} @change=${changed}></ha-switch>
    </ha-notifications-setting-row>`);
    const row = container.querySelector<SettingRow>("ha-notifications-setting-row")!;
    await settleElement(row);
    const heading = settingRowHeading(row);
    const label = row.querySelector('[slot="label"]')!;
    const help = row.querySelector<HelpIcon>('[slot="help"]')!;
    await settleElement(help);
    const toggle = row.querySelector<HTMLElement & { checked: boolean; disabled: boolean }>("ha-switch")!;
    expect(heading.firstElementChild?.localName).toBe("span");
    expect(settingRowSlot(row, "label").parentElement).toBe(heading.firstElementChild);
    expect(heading.lastElementChild).toBe(settingRowSlot(row, "help"));
    expect(settingRowSlot(row, "label").assignedElements()).toEqual([label]);
    expect(settingRowSlot(row, "help").assignedElements()).toEqual([help]);
    expect(settingRowSlot(row, "toggle").assignedElements()).toEqual([toggle]);
    expect(settingRowSlot(row, "toggle").previousElementSibling).toBe(heading);
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute("aria-label")).toBe(label.textContent);
    const change = new Event("change", { bubbles: true });
    const bubbled = vi.fn();
    row.addEventListener("change", bubbled);
    toggle.dispatchEvent(change);
    await testUser().click(help.shadowRoot!.querySelector("ha-icon-button")!);
    expect(changed).toHaveBeenCalledExactlyOnceWith(change);
    expect(bubbled).toHaveBeenCalledExactlyOnceWith(change);
    expect(helpRequested).toHaveBeenCalledOnce();
    expect((helpRequested.mock.calls[0][0] as CustomEvent<HelpRequestDetail>).detail)
      .toEqual({ title: "Persistent notification", entries });
  });
});

describe("help icon", () => {
  it("owns the accessible native info button and emits a bubbling composed help request", async () => {
    const requested = vi.fn();
    const entries = [{ title: "Description", text: "An optional note." }];
    const container = renderTemplate(html`<ha-notifications-help-icon class="nc-help" .heading=${"Basics"}
      .moreInfo=${"More information"} .entries=${entries}></ha-notifications-help-icon>`);
    container.addEventListener("help-request", requested);
    const help = container.querySelector<HelpIcon>("ha-notifications-help-icon")!;
    await settleElement(help);
    const button = help.shadowRoot!.querySelector<HTMLElement & { path: string; label: string }>("ha-icon-button")!;
    expect(help.querySelector("ha-icon-button")).toBeNull();
    expect(button.path).toBe(mdiInformationOutline);
    expect(button.label).toBe("More information: Basics");
    expect(button.title).toBe(help.title);
    expect(help.title).toBe("More information: Basics");
    await testUser().click(button);
    expect(requested).toHaveBeenCalledOnce();
    const event = requested.mock.calls[0][0] as CustomEvent<HelpRequestDetail>;
    expect(event.target).toBe(help);
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(event.detail).toEqual({ title: "Basics", entries });
    expect(event.detail.entries).toBe(entries);
    expect(container.querySelector("ha-dialog")).toBeNull();
    expect(HelpIcon.styles.toString()).toContain("--mdc-icon-button-size: 32px;");
    expect(HelpIcon.styles.toString()).toContain("--mdc-icon-size: 20px;");
    expect(HelpIcon.styles.toString()).toContain("color: var(--secondary-text-color);");
  });

  it.each([
    { heading: "Notification", moreInfo: "More information" },
    { heading: "Basics", moreInfo: "Weitere Informationen" },
    { heading: "Notification", moreInfo: "Weitere Informationen" },
  ])("updates the tooltip, native label and help payload for $moreInfo: $heading without rebuilding the button", async ({ heading, moreInfo }) => {
    const container = renderTemplate(html`<ha-notifications-help-icon .heading=${"Basics"}
      .moreInfo=${"More information"} .entries=${[{ text: "Original help." }]}></ha-notifications-help-icon>`);
    const help = container.querySelector<HelpIcon>("ha-notifications-help-icon")!;
    await settleElement(help);
    const button = help.shadowRoot!.querySelector<HTMLElement & { label: string }>("ha-icon-button")!;
    const entries = [{ text: "Updated help." }];
    help.heading = heading;
    help.moreInfo = moreInfo;
    help.entries = entries;
    await settleElement(help);
    expect(help.shadowRoot!.querySelector("ha-icon-button")).toBe(button);
    expect(help.title).toBe(`${moreInfo}: ${heading}`);
    expect(button.title).toBe(help.title);
    expect(button.label).toBe(help.title);
    const requested = vi.fn();
    container.addEventListener("help-request", requested);
    await testUser().click(button);
    expect(requested).toHaveBeenCalledOnce();
    expect((requested.mock.calls[0][0] as CustomEvent<HelpRequestDetail>).detail).toEqual({ title: heading, entries });
  });
});