// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { defaultAlert } from "../../frontend/editor/helpers.js";
import { openEditor } from "../../frontend/editor/index.js";
import { editorSections } from "../../frontend/editor/types.js";
import { createRecipientPicker } from "../../frontend/recipient-picker.js";
import type { Hass } from "../../frontend/types.js";
import {
  editorAlertFixture,
  editorOptions,
  editorQueries,
  editorRoot,
  domQueries,
  draftAlertFixture,
  emptyRegistries,
  installHaTestElements,
  populatedRegistries,
  stableMarkup,
  testUser,
} from "./conftest.js";

installHaTestElements();

function sectionContract(section: Element | null) {
  if (!section) {
    return null;
  }

  const text = (element: Element): string =>
    element.textContent?.replace(/\s+/g, " ").trim() || "";

  return {
    title: section.getAttribute("data-title"),
    controls: [
      ...section.querySelectorAll(
        "ha-input, ha-selector, ha-switch, ha-code-editor, ha-icon-picker",
      ),
    ].map((element) =>
      [
        element.tagName.toLowerCase(),
        element.getAttribute("aria-label"),
        element.getAttribute("mode"),
        element.getAttribute("data-role"),
      ]
        .filter(Boolean)
        .join(":"),
    ),
    buttons: [...section.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") || text(button),
    ),
    help: [...section.querySelectorAll(".nc-help")].map(text),
  };
}

describe("alert editor interactions", () => {
  it("loads populated alert and registry fixture data", async () => {
    const root = editorRoot();
    openEditor(
      editorOptions(root, editorAlertFixture(), populatedRegistries()),
    );
    await Promise.resolve();

    expect({
      name: root.querySelector('[data-role="editor-alert-name"]')?.textContent,
      conditionRows: root.querySelectorAll(".nc-condition-row").length,
      selectedRecipients: [
        ...root.querySelectorAll(".nc-target-chip"),
      ].map((chip) => chip.textContent?.replace(/\s+/g, " ").trim()),
      intervalEnabled: (
        root.querySelector('[data-role="interval-toggle"]') as HTMLElement & {
          checked: boolean;
        }
      )?.checked,
      confirmationEnabled: (
        root.querySelector(
          '[data-role="editor-section-control"][data-setting="confirmation"] ha-switch',
        ) as HTMLElement & { checked: boolean }
      )?.checked,
      actionEditors: [
        ...root.querySelectorAll("ha-code-editor[data-role]")
      ].map((editor) => ({
        role: editor.getAttribute("data-role"),
        value: (editor as HTMLElement & { value?: string }).value,
      })),
    }).toMatchSnapshot();
  });

  it.each(editorSections.map(({ title }) => title))(
    "renders the %s editor section",
    async (title) => {
      const root = editorRoot();
      openEditor(editorOptions(root));

      expect(sectionContract(root.querySelector(`[data-title="${title}"]`))).toMatchSnapshot();
    },
  );

  it("adds and removes confirmation response buttons", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    openEditor(editorOptions(root));

    await user.click(queries.getAllByRole("button", { name: /Confirmation/ })[0]);
    await user.click(queries.getByRole("button", { name: "Add response button" }));

    expect(queries.getByRole("button", { name: "Remove button" })).not.toBeNull();
    await user.click(queries.getByRole("button", { name: "Remove button" }));
    expect(root.querySelectorAll(".nc-confirmation-button-row")).toHaveLength(1);
  });

  it("switches active sections and keeps the contextual title", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    openEditor(editorOptions(root));

    const sectionButtons = queries.getAllByRole("button", {
      name: /When to check/,
    });
    await user.click(sectionButtons[0]);

    expect(
      stableMarkup(root.querySelector('[data-role="editor-section-title"]')),
    ).toMatchSnapshot();
    expect(root.querySelectorAll(".nc-section.active")).toHaveLength(1);
    expect(sectionButtons[0].classList.contains("active")).toBe(true);
  });

  it("renders the native condition YAML editor", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    openEditor(editorOptions(root));
    await user.click(
      queries.getAllByRole("button", { name: /Condition/ })[0],
    );

    expect(root.querySelector('[data-role="conditions-yaml"]')?.hidden).toBe(false);
    expect(root.querySelector('[data-role="conditions-yaml-editor"]')).not.toBeNull();
  });

  it("updates confirmation state and status indicators when toggled", () => {
    const root = editorRoot();
    openEditor(editorOptions(root, defaultAlert()));

    const confirmationSwitch = root.querySelector<HTMLElement>(
      '[data-role="editor-section-control"][data-setting="confirmation"] ha-switch',
    );
    const confirmationControl = root.querySelector<HTMLElement>(
      '[data-role="editor-section-control"][data-setting="confirmation"]',
    );
    expect(confirmationSwitch).not.toBeNull();
    expect(confirmationControl?.querySelector(".nc-setting-state")).toBeNull();
    expect(confirmationSwitch?.getAttribute("aria-label")).toBe(
      "Enable confirmation",
    );
    expect(
      root.querySelector(
        '.nc-section-status[data-status="confirmation"]',
      )?.getAttribute("aria-label"),
    ).toBe("Disabled");

    (confirmationSwitch as HTMLElement & { checked: boolean }).checked = true;
    confirmationSwitch?.dispatchEvent(new Event("change", { bubbles: true }));

    expect((confirmationSwitch as HTMLElement & { checked: boolean }).checked).toBe(
      true,
    );
    const updatedConfirmationSwitch = root.querySelector<HTMLElement>(
      '[data-role="editor-section-control"][data-setting="confirmation"] ha-switch',
    );
    expect(updatedConfirmationSwitch?.getAttribute("aria-label")).toBe(
      "Disable confirmation",
    );
    expect(
      root.querySelector(
        '.nc-section-status[data-status="confirmation"]',
      )?.getAttribute("aria-label"),
    ).toBe("Enabled");
    expect(root.querySelector(".nc-editor-state")?.textContent).toBe(
      "Unsaved changes",
    );

    (confirmationSwitch as HTMLElement & { checked: boolean }).checked = false;
    confirmationSwitch?.dispatchEvent(new Event("change", { bubbles: true }));

    expect((confirmationSwitch as HTMLElement & { checked: boolean }).checked).toBe(
      false,
    );
    const resetConfirmationSwitch = root.querySelector<HTMLElement>(
      '[data-role="editor-section-control"][data-setting="confirmation"] ha-switch',
    );
    expect(resetConfirmationSwitch?.getAttribute("aria-label")).toBe(
      "Enable confirmation",
    );
    expect(
      root.querySelector(
        '.nc-section-status[data-status="confirmation"]',
      )?.getAttribute("aria-label"),
    ).toBe("Disabled");
  });

  it("shows a validation error for malformed Conditions YAML", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    const options = editorOptions(root);
    openEditor(options);
    await user.click(queries.getAllByRole("button", { name: /Condition/ })[0]);
    const yamlEditor = root.querySelector<HTMLElement & { value: string }>(
      '[data-role="conditions-yaml-editor"]',
    );
    yamlEditor.value = "- true";
    await user.click(queries.getByRole("button", { name: "Validate condition" }));

    await vi.waitFor(() => {
      expect(root.querySelector(".nc-toast")?.textContent).toContain(
        "Conditions YAML must be a list of mappings.",
      );
    });
    expect(options.onValidateCondition).not.toHaveBeenCalled();
  });

  it("opens and closes the mobile section menu", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    openEditor(editorOptions(root));

    const menuButton = queries.getByRole("button", { name: "Manage sections" });
    const menu = root.querySelector(".nc-mobile-section-menu");
    await user.click(menuButton);

    expect(menu?.classList.contains("mobile-open")).toBe(true);
    expect(menuButton?.getAttribute("aria-expanded")).toBe("true");

    await user.click(menuButton);
    expect(menu?.classList.contains("mobile-open")).toBe(false);
    expect(menuButton?.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens template help in a modal from the notification section", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    openEditor(editorOptions(root));
    await user.click(queries.getAllByRole("button", { name: /Notification/ })[0]);

    await user.click(
      queries.getAllByRole("button", {
        name: "Show template variables and sensor helpers",
      })[0],
    );

    expect(stableMarkup(root.querySelector(".nc-template-help-modal"))).toMatchSnapshot();
    await user.click(queries.getByRole("button", { name: "Close template help" }));
    expect(root.querySelector(".nc-template-help-modal")).toBeNull();
  });

  it("previews unsaved data without requiring recipients", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    const alert = defaultAlert();
    alert.id = "draft_alert";
    openEditor(editorOptions(root, alert));

    const nameInput = root.querySelector(".nc-section ha-input") as HTMLElement & {
      value: string;
    };
    nameInput.value = "Draft alert";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    await user.click(queries.getByRole("button", { name: "View alert YAML" }));
    await Promise.resolve();
    await Promise.resolve();

    const editor = root.querySelector(".nc-alert-yaml-modal ha-code-editor") as
      | (HTMLElement & { value: string })
      | null;
    expect(editor?.value).toMatchSnapshot();
  });

  it("shows validation feedback instead of saving an unnamed alert", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    const options = editorOptions(root);
    openEditor(options);

    await user.click(queries.getByRole("button", { name: "Save alert" }));

    expect(stableMarkup(root.querySelector(".nc-toast"))).toMatchSnapshot();
    expect(options.onSave).not.toHaveBeenCalled();
  });

  it("saves an edited alert and closes the editor", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    const alert = draftAlertFixture({
      id: "editable_alert",
      name: "Original name",
      conditions: [{ condition: "template", value_template: "{{ true }}" }],
      notification: {
        action: "notify.phone",
        target: { entity_id: ["notify.phone"] },
        data: {},
      },
    });
    const registries = {
      ...emptyRegistries(),
      entities: [{ entity_id: "notify.phone", name: "Phone" }],
    };
    const options = editorOptions(root, alert, registries);
    openEditor(options);

    const nameInput = root.querySelector(".nc-section ha-input") as HTMLElement & {
      value: string;
    };
    nameInput.value = "Updated name";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await user.click(queries.getByRole("button", { name: "Save alert" }));
    await Promise.resolve();
    await vi.waitFor(() => {
      expect(root.querySelector(".nc-editor-view")).toBeNull();
    });

    expect(options.onSave).toHaveBeenCalledOnce();
    expect(options.onSave.mock.calls[0][0]).toMatchSnapshot();
    expect(options.onSaved).toHaveBeenCalledOnce();
    expect(options.onClosed).toHaveBeenCalledOnce();
  });

  it("closes a clean editor without opening the discard dialog", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const options = editorOptions(root);
    openEditor(options);

    await testUser().click(queries.getByRole("button", { name: "Cancel" }));

    expect(root.querySelector(".nc-discard-modal")).toBeNull();
    expect(root.querySelector(".nc-editor-view")).toBeNull();
    expect(options.onClosed).toHaveBeenCalledOnce();
  });

  it("asks before discarding unsaved changes", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    openEditor(editorOptions(root));
    const nameInput = root.querySelector(".nc-section ha-input") as HTMLElement & {
      value: string;
    };
    nameInput.value = "Draft";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    await user.click(queries.getByRole("button", { name: "Cancel" }));
    expect(
      root.querySelector(".nc-discard-modal")?.textContent?.replace(/\s+/g, " ").trim(),
    ).toMatchSnapshot();

    await user.click(queries.getByRole("button", { name: "Stay" }));
    expect(root.querySelector(".nc-editor-view")).not.toBeNull();
    expect(root.querySelector(".nc-discard-modal")).toBeNull();
  });
});

describe("recipient picker interactions", () => {
  it("preserves selected recipients missing from the registry", () => {
    const picker = createRecipientPicker(
      emptyRegistries(),
      { entity_id: ["notify.missing"] },
      vi.fn(),
    );

    expect(picker.target()).toEqual({ entity_id: ["notify.missing"] });
    expect(picker.element.textContent).toContain("notify.missing");
  });

  it("serializes a selected notification entity and marks the editor dirty", async () => {
    const markDirty = vi.fn();
    const picker = createRecipientPicker(
      {
        ...emptyRegistries(),
        entities: [{ entity_id: "notify.phone", name: "Phone" }],
      },
      {},
      markDirty,
    );
    const queries = domQueries(picker.element);
    const user = testUser();
    const search = picker.element.querySelector("ha-input") as HTMLElement;
    search.dispatchEvent(new Event("focus", { bubbles: true }));

    await user.click(queries.getByRole("button", { name: "Phone" }));

    expect(picker.target()).toMatchSnapshot();
    expect(
      stableMarkup(picker.element.querySelector(".nc-target-chip")),
    ).toMatchSnapshot();
    expect(markDirty).toHaveBeenCalledOnce();
  });

  it("filters recipients and removes a selected target", async () => {
    const markDirty = vi.fn();
    const picker = createRecipientPicker(
      {
        ...emptyRegistries(),
        entities: [
          { entity_id: "notify.phone", name: "Phone" },
          { entity_id: "notify.tablet", name: "Tablet" },
        ],
      },
      {},
      markDirty,
    );
    const queries = domQueries(picker.element);
    const user = testUser();
    const search = picker.element.querySelector("ha-input") as HTMLElement & {
      value: string;
    };

    await user.click(search);
    search.value = "tablet";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await user.click(queries.getByRole("button", { name: "Tablet" }));
    expect(picker.target()).toMatchSnapshot();

    await user.click(queries.getByRole("button", { name: "Remove" }));
    expect(picker.target()).toEqual({});
    expect(markDirty).toHaveBeenCalledTimes(2);
  });
});