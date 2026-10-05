// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";
import { alertList, type AlertHandlers } from "../../frontend/views/alerts.js";
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
    "View history", "Open automation", "Cancel active runs", "Delete alert",
  ]);
  const labelledButtons = [...container.querySelectorAll(".nc-alert-labelled-actions ha-button")];
  expect(labelledButtons.map(button => button.textContent?.trim())).toEqual(narrow ? [] : [
    "View history", "Open automation", "Cancel active runs", "Delete alert",
  ]);
  expect(container.querySelectorAll('.nc-alert-labelled-actions ha-svg-icon[slot="start"]')).toHaveLength(narrow ? 0 : 4);
  if (!narrow) {
    labelledButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(on.history).toHaveBeenCalledWith(alert);
    expect(on.edit).not.toHaveBeenCalled();
    vi.mocked(on.history).mockClear();
  }
  menu.items[0].action();
  expect(on.history).toHaveBeenCalledWith(alert);
  menu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(on.edit).not.toHaveBeenCalled();
  menu.items[1].action();
  expect(on.navigate).toHaveBeenCalledWith("/config/automation/edit/door_automation");
});