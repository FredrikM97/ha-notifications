// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { mdiCheckCircle, mdiCloseCircle } from "@mdi/js";
import { navMenu, uiStyles } from "../../frontend/ui.js";
import { findSection, sectionStatus } from "../../frontend/editor/sections.js";
import { cleanupTestDom, draftAlertFixture, editableAlert, renderTemplate } from "./conftest.js";

afterEach(cleanupTestDom);

const items = [
  { key: "basic", label: "Basic" },
  { key: "triggers", label: "Triggers", status: true },
  { key: "confirmation", label: "Confirmation", status: false },
];

describe("section navigation status", () => {
  it("separates parent sections from child items without spacing the first item", () => {
    const container = renderTemplate(navMenu([
      { key: "when", label: "When to run" },
      { key: "triggers", label: "Triggers", child: true },
      { key: "recipients", label: "Recipients" },
    ], "triggers", vi.fn(), false, "Sections"));
    const recipients = [...container.querySelectorAll("button")]
      .find(button => button.textContent?.trim() === "Recipients")!;
    expect(recipients.matches(".nc-nav-item + .nc-nav-item:not(.nc-child)")).toBe(true);
    expect(container.querySelector("button")!.matches(".nc-nav-item + .nc-nav-item:not(.nc-child)")).toBe(false);
    expect(uiStyles.cssText).toContain("gap: var(--ha-space-1, 4px);");
    expect(uiStyles.cssText).toContain("margin-block-start: var(--ha-space-2, 8px);");
  });

  it.each([false, true])("section status follows its own enabled flag=%s", enabled => {
    const alert = editableAlert(draftAlertFixture());
    alert.enabled = true;
    alert.monitor.triggers.enabled = enabled;
    alert.monitor.conditions.enabled = !enabled;
    alert.monitor.conditions.items = [{ condition: "state", entity_id: "binary_sensor.door", state: "on" }];
    alert.monitor.triggers.items = [
      { trigger: "state", entity_id: "binary_sensor.door", to: "on" },
      { trigger: "homeassistant", event: "start" },
      { trigger: "time_pattern", minutes: "/5" },
    ];
    expect(sectionStatus(alert, findSection("when"))).toBeUndefined();
    expect(sectionStatus(alert, findSection("triggers"))).toBe(enabled);
    expect(sectionStatus(alert, findSection("conditions"))).toBe(!enabled);
  });

  it.each([false, true])("renders both status icons in narrow=%s navigation", narrow => {
    const container = renderTemplate(navMenu(items, "basic", vi.fn(), narrow, "Sections"));
    const icons = [...container.querySelectorAll<HTMLElement & { path: string }>(".nc-dot")];
    expect(icons).toHaveLength(2);
    expect(icons[0].path).toBe(mdiCheckCircle);
    expect(icons[0].classList.contains("on")).toBe(true);
    expect(icons[0].getAttribute("aria-label")).toBe("Enabled");
    expect(icons[1].path).toBe(mdiCloseCircle);
    expect(icons[1].classList.contains("on")).toBe(false);
    expect(icons[1].getAttribute("aria-label")).toBe("Disabled");
    if (narrow) expect(icons.every(icon => icon.slot === "icon")).toBe(true);
  });

  it("updates the selected dropdown icon and supports localized status labels", () => {
    const labels = { on: "Active section", off: "Inactive section" };
    const select = vi.fn();
    const container = renderTemplate(navMenu(items, "triggers", select, true, "Sections", labels));
    const selectedIcon = () => container.querySelector<HTMLElement & { path: string }>(
      'ha-button[slot="trigger"] .nc-dot',
    )!;
    expect(selectedIcon().slot).toBe("start");
    expect(selectedIcon().path).toBe(mdiCheckCircle);
    expect(selectedIcon().getAttribute("aria-label")).toBe(labels.on);

    render(navMenu(items, "confirmation", select, true, "Sections", labels), container);
    expect(selectedIcon().path).toBe(mdiCloseCircle);
    expect(selectedIcon().getAttribute("aria-label")).toBe(labels.off);

    render(navMenu(items, "basic", select, true, "Sections", labels), container);
    expect(selectedIcon()).toBeNull();
  });
});