// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";
import { alertList, alertListStyles, type AlertHandlers } from "../../frontend/views/alerts.js";
import type { Action } from "../../frontend/ui.js";
import type { AutomationRuntimeStatus } from "../../frontend/types.js";
import { cleanupTestDom, draftAlertFixture, renderTemplate } from "./conftest.js";

afterEach(cleanupTestDom);

it.each([false, true])("uses native responsive row actions with narrow=%s", narrow => {
  const alert = draftAlertFixture({ id: "door", name: "Door" });
  const on: AlertHandlers = {
    create: vi.fn(), edit: vi.fn(), toggle: vi.fn(), history: vi.fn(),
    remove: vi.fn(), cancelRun: vi.fn(), navigate: vi.fn(),
  };
  const status: AutomationRuntimeStatus = {
    status: "managed", enabled: true, mode: "parallel", current: 1, automation_id: "door_automation",
  };
  const container = renderTemplate(alertList(null, [alert], { door: status }, false, on, narrow));
  const toggleColumn = container.querySelector(".nc-alert-toggle")!;
  expect(toggleColumn.parentElement!.lastElementChild).toBe(toggleColumn);
  const toggle = toggleColumn.querySelector("ha-switch")!;
  toggle.dispatchEvent(new Event("change", { bubbles: true }));
  expect(on.toggle).toHaveBeenCalledExactlyOnceWith(alert);
  toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(on.edit).not.toHaveBeenCalled();
  const menu = container.querySelector("ha-icon-overflow-menu") as HTMLElement & {
    narrow: boolean;
    items: Action[];
  };
  expect(menu.narrow).toBe(narrow);
  expect(menu.items.map(item => item.label)).toEqual([
    "View history", "Edit alert", "Open automation", "Cancel active runs", "Delete alert",
  ]);
  const labelledButtons = [...container.querySelectorAll(".nc-alert-labelled-actions ha-button")];
  if (!narrow) {
    expect(labelledButtons.every(button => button.getAttribute("appearance") === "outlined")).toBe(true);
  }
  expect(labelledButtons.map(button => button.textContent?.trim())).toEqual(narrow ? [] : [
    "View history", "Edit alert", "Open automation", "Cancel active runs", "Delete alert",
  ]);
  expect(container.querySelectorAll('.nc-alert-labelled-actions ha-svg-icon[slot="start"]')).toHaveLength(narrow ? 0 : 5);
  if (!narrow) {
    labelledButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(on.history).toHaveBeenCalledWith(alert);
    expect(on.edit).not.toHaveBeenCalled();
    vi.mocked(on.history).mockClear();
    labelledButtons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(on.edit).toHaveBeenCalledExactlyOnceWith(alert);
    vi.mocked(on.edit).mockClear();
  }
  menu.items[0].action();
  expect(on.history).toHaveBeenCalledWith(alert);
  menu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(on.edit).not.toHaveBeenCalled();
  menu.items[1].action();
  expect(on.edit).toHaveBeenCalledExactlyOnceWith(alert);
  menu.items[2].action();
  expect(on.navigate).toHaveBeenCalledWith("/config/automation/edit/door_automation");
  menu.items[3].action();
  expect(on.cancelRun).toHaveBeenCalledExactlyOnceWith(alert);
});

it("scopes theme contrast and keyboard focus to native row controls", () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(alertListStyles.cssText);
  const rules = [...sheet.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
  const controls = rules.find(rule => rule.selectorText === ".nc-alert-controls")!;
  expect(controls.style.color).toBe("var(--primary-text-color)");
  expect(controls.style.getPropertyValue("--wa-focus-ring")).toBe("2px solid var(--primary-color)");
  const buttons = rules.find(rule => rule.selectorText === '.nc-alert-labelled-actions ha-button[variant="neutral"]')!;
  expect(buttons.style.getPropertyValue("--wa-color-on-quiet")).toBe("var(--primary-text-color)");
  expect(buttons.style.getPropertyValue("--wa-color-fill-quiet")).toBe("color-mix(in srgb, var(--primary-text-color) 12%, transparent)");
  expect(alertListStyles.cssText).toContain(`.nc-alert-labelled-actions ha-button[variant="neutral"]::part(base):focus-visible {
    background-color: var(--wa-color-fill-quiet);
  }`);
  expect(rules.some(rule => rule.selectorText.includes('variant="danger"'))).toBe(false);
  const hover = rules.find(rule => rule.selectorText.includes("ha-icon-overflow-menu:hover"))!;
  expect(hover.selectorText).toContain("ha-button:hover");
  expect(hover.selectorText).toContain("ha-icon-overflow-menu:focus-within");
  expect(alertListStyles.cssText).toContain("background-color: color-mix(in srgb, var(--primary-text-color) 12%, transparent);");
});

it.each(["Enter", " "])("opens the row with %s without treating control key events as row activation", key => {
  const alert = draftAlertFixture({ id: "door", name: "Door" });
  const on: AlertHandlers = {
    create: vi.fn(), edit: vi.fn(), toggle: vi.fn(), history: vi.fn(),
    remove: vi.fn(), cancelRun: vi.fn(), navigate: vi.fn(),
  };
  const container = renderTemplate(alertList(null, [alert], {}, false, on, false));
  const row = container.querySelector(".nc-alert")!;
  row.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  expect(on.edit).toHaveBeenCalledExactlyOnceWith(alert);
  vi.mocked(on.edit).mockClear();
  for (const control of container.querySelectorAll("ha-button, ha-icon-overflow-menu, ha-switch")) {
    control.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  }
  expect(on.edit).not.toHaveBeenCalled();
});