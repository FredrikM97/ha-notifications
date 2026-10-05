// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { mdiCheckCircle, mdiCloseCircle } from "@mdi/js";
import { navMenu } from "../../frontend/ui.js";
import { editableAlert } from "../../frontend/editor/alert-model.js";
import { editorSections, sectionStatus, type EditorState } from "../../frontend/editor/sections.js";
import { cleanupTestDom, draftAlertFixture, homeAssistantFixture, renderTemplate } from "./conftest.js";

afterEach(cleanupTestDom);

const items = [
  { key: "basic", label: "Basic" },
  { key: "triggers", label: "Triggers", status: true },
  { key: "confirmation", label: "Confirmation", status: false },
];

describe("section navigation status", () => {
  it.each([
    { startup: false, periodic: false, enabled: false },
    { startup: true, periodic: false, enabled: true },
    { startup: false, periodic: true, enabled: true },
    { startup: true, periodic: true, enabled: true },
  ])("Conditions status follows startup=$startup and periodic=$periodic only", ({ startup, periodic, enabled }) => {
    const alert = editableAlert(draftAlertFixture());
    alert.conditions = [{ condition: "state", entity_id: "binary_sensor.door", state: "on" }];
    alert.on_condition_change = true;
    alert.triggers = [
      { trigger: "state", entity_id: "binary_sensor.door", to: "on" },
      ...(startup ? [{ trigger: "homeassistant", event: "start" }] : []),
      ...(periodic ? [{ trigger: "time_pattern", minutes: "/5" }] : []),
    ];
    const state: EditorState = {
      alert, hass: homeAssistantFixture(), localize: () => "", users: [], postConfirmationActions: false,
    };
    expect(sectionStatus(editorSections.find(section => section.key === "conditions")!, state)).toBe(enabled);
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