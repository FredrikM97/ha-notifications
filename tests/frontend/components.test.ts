// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { render } from "lit";
import {
  button,
  buttonComponent,
  buttonComponentStyles,
} from "../../frontend/components/button.js";
import { defaultAlert } from "../../frontend/editor/alert-defaults.js";
import { openEditor } from "../../frontend/editor/index.js";
import { editorSections } from "../../frontend/editor/types.js";
import { createRecipientPicker } from "../../frontend/components/recipient-picker.js";
import "../../frontend/panel/alert-card.js";
import type { AlertActionItem } from "../../frontend/panel/alert-card/actions.js";
import type { Hass } from "../../frontend/types.js";
import {
  editorAlertFixture,
  editorOptions,
  editorQueries,
  editorRoot,
  configuredAlertFixture,
  domQueries,
  draftAlertFixture,
  emptyRegistries,
  installHaTestElements,
  populatedRegistries,
  stableMarkup,
  settleEditorNavigation,
  testUser,
} from "./conftest.js";

installHaTestElements();

describe("shared button component", () => {
  it("renders an accessible native button template", () => {
    const host = document.createElement("div");
    const onClick = vi.fn();
    render(
      button({
        label: "Delete alert",
        variant: "danger",
        icon: "mdi:delete-outline",
        onClick,
      }),
      host,
    );

    const element = host.querySelector<HTMLButtonElement>("button");
    expect(element?.className).toBe("nc-button danger");
    expect(element?.type).toBe("button");
    expect(element?.getAttribute("aria-label")).toBe("Delete alert");
    expect(element?.querySelector("ha-icon")?.getAttribute("icon")).toBe(
      "mdi:delete-outline",
    );
    element?.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(buttonComponentStyles.cssText).toContain("button.danger");
  });

  it("provides a component-owned native button for editor controls", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    render(buttonComponent({ label: "Save", variant: "secondary" }), host);
    const component = host.querySelector<HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<unknown>;
    }>("ha-notifications-button");
    await component?.updateComplete;
    expect(component?.shadowRoot.querySelector("button.secondary")).not.toBeNull();
    host.remove();
  });
});

function sectionContract(section: Element | null) {
  if (!section) {
    return null;
  }

  const contentRoot = section.shadowRoot || section;
  const text = (element: Element): string =>
    element.textContent?.replace(/\s+/g, " ").trim() || "";
  const nestedQuery = (container: ParentNode, selector: string): Element[] => {
    const matches = [...container.querySelectorAll(selector)];
    for (const element of container.querySelectorAll("*")) {
      if (
        element.shadowRoot &&
        !element.matches("ha-notifications-duration-input")
      ) {
        matches.push(...nestedQuery(element.shadowRoot, selector));
      }
    }
    return matches;
  };
  const controlElements = nestedQuery(
    contentRoot,
    "ha-input, ha-selector, ha-switch, ha-notifications-code-editor, ha-icon-picker, ha-notifications-duration-input",
  );
  const buttons = nestedQuery(contentRoot, "button");

  return {
    title: section.getAttribute("data-title"),
    controls: controlElements.map((element) =>
      [
        element.tagName.toLowerCase(),
        element.getAttribute("aria-label"),
        element.getAttribute("mode"),
        element.getAttribute("data-role"),
      ]
        .filter(Boolean)
        .join(":"),
    ),
    buttons: buttons.map(
      (button) => button.getAttribute("aria-label") || text(button),
    ),
    help: nestedQuery(contentRoot, ".nc-help").map(text),
  };
}

describe("alert editor interactions", () => {
  it("loads populated alert and registry fixture data", async () => {
    const root = editorRoot();
    openEditor(
      editorOptions(root, editorAlertFixture(), populatedRegistries()),
    );
    await Promise.resolve();

    expect(
      root.querySelector("ha-notifications-alert-editor")?.shadowRoot,
    ).not.toBeNull();
    expect({
      name: root.querySelector('[data-role="editor-alert-name"]')?.textContent,
      conditionRows: root.querySelectorAll(".nc-condition-row").length,
      selectedRecipients: [
        ...(root
          .querySelector("ha-notifications-recipient-picker")
          ?.shadowRoot?.querySelectorAll(".nc-target-chip") || []),
      ].map((chip) => chip.textContent?.replace(/\s+/g, " ").trim()),
      intervalEnabled: (
        root.querySelector('[data-role="interval-toggle"]') as HTMLElement & {
          checked: boolean;
        }
      )?.checked,
      confirmationEnabled: (
        root
          .querySelector<HTMLElement & { shadowRoot: ShadowRoot }>(
            '[data-role="editor-section-control"][data-setting="confirmation"] ha-notifications-setting-toggle',
          )
          ?.shadowRoot.querySelector("ha-switch") as
          | (HTMLElement & { checked: boolean })
          | null
      )?.checked,
      actionEditors: [
        ...root.querySelectorAll("ha-notifications-code-editor[data-role]")
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

  it("shows the header control matching the selected optional section", async () => {
    const root = editorRoot();
    const user = testUser();
    openEditor(editorOptions(root));
    await settleEditorNavigation(root);

    for (const { title, setting } of editorSections.filter(
      (section) => section.setting,
    )) {
      const navigationButton = [...root.querySelectorAll<HTMLButtonElement>(
        ".nc-section-nav-button",
      )].find((button) => button.textContent?.includes(title));
      expect(navigationButton).toBeDefined();
      await user.click(navigationButton!);
      await settleEditorNavigation(root);

      for (const control of root.querySelectorAll<HTMLElement>(
        '[data-role="editor-section-control"]',
      )) {
        expect(control.hidden).toBe(control.dataset.setting !== setting);
      }
    }
  });

  it("adds and removes confirmation response buttons", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    openEditor(editorOptions(root));
    await settleEditorNavigation(root);

    await user.click(queries.getAllByRole("button", { name: /Confirmation/ })[0]);
    const buttonIds = root.querySelector<HTMLDetailsElement>(
      ".nc-confirmation-button-ids",
    );
    expect(buttonIds?.open).toBe(false);
    expect(buttonIds?.querySelector("summary")?.textContent).toContain(
      "Button IDs (optional)",
    );
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
    await settleEditorNavigation(root);

    const sectionButtons = queries.getAllByRole("button", {
      name: /When to run/,
    });
    await user.click(sectionButtons[0]);
    await settleEditorNavigation(root);

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
    await settleEditorNavigation(root);
    await user.click(
      queries.getAllByRole("button", { name: /Condition/ })[0],
    );

    expect(root.querySelector('[data-role="conditions-yaml"]')?.hidden).toBe(false);
    expect(root.querySelector('[data-role="conditions-yaml-editor"]')).not.toBeNull();
  });

  it("keeps built-in triggers out of Triggers YAML and merges custom YAML on save", async () => {
    const root = editorRoot();
    const user = testUser();
    const alert = draftAlertFixture({
      name: "Sensor alert",
      triggers: [
        { trigger: "homeassistant", event: "start" },
        { trigger: "time_pattern", minutes: "/5" },
        { trigger: "state", entity_id: "sensor.old" },
      ],
      notification: {
        action: "notify.phone",
        target: { entity_id: ["notify.phone"] },
        data: {},
      },
    });
    const options = editorOptions(root, alert);
    openEditor(options);

    const triggersEditor = root.querySelector<HTMLElement & { value: string }>(
      '[data-role="triggers-yaml-editor"]',
    );
    expect(triggersEditor?.value).toContain("sensor.old");
    expect(triggersEditor?.value).not.toContain("homeassistant");
    expect(triggersEditor?.value).not.toContain("time_pattern");
    expect(
      root.querySelector<HTMLElement & { placeholder?: string }>(
        '[data-role="triggers-yaml-editor"]',
      )?.placeholder,
    ).toContain("- trigger: state");

    if (!triggersEditor) throw new Error("Triggers editor is missing.");
    triggersEditor.value = "- trigger: state\n  entity_id: sensor.new\n";
    triggersEditor.dispatchEvent(new Event("input", { bubbles: true }));
    await user.click(editorQueries(root).getByRole("button", { name: "Save alert" }));

    expect(options.onSave.mock.calls[0][0].triggers).toEqual([
      { trigger: "homeassistant", event: "start" },
      { trigger: "time_pattern", minutes: "/5" },
      { trigger: "state", entity_id: "sensor.new" },
    ]);
  });

  it("keeps confirmation follow-up notifications disabled by default", async () => {
    const root = editorRoot();
    openEditor(editorOptions(root, defaultAlert()));
    await settleEditorNavigation(root);

    const notificationToggle = root.querySelector<HTMLElement & {
      shadowRoot: ShadowRoot;
    }>(
      '[data-role="editor-section-control"][data-setting="confirmationNotification"] ha-notifications-setting-toggle',
    );
    const notificationSwitch = notificationToggle?.shadowRoot.querySelector<HTMLElement & {
      checked: boolean;
    }>("ha-switch");
    expect(notificationSwitch?.checked).toBe(false);
  });

  it("updates confirmation state and status indicators when toggled", async () => {
    const root = editorRoot();
    openEditor(editorOptions(root, defaultAlert()));
    await settleEditorNavigation(root);

    const confirmationToggle = root.querySelector<HTMLElement & {
      shadowRoot: ShadowRoot;
    }>(
      '[data-role="editor-section-control"][data-setting="confirmation"] ha-notifications-setting-toggle',
    );
    const confirmationSwitch = confirmationToggle?.shadowRoot.querySelector<HTMLElement>(
      "ha-switch",
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
    await settleEditorNavigation(root);

    expect((confirmationSwitch as HTMLElement & { checked: boolean }).checked).toBe(
      true,
    );
    const updatedConfirmationToggle = root.querySelector<HTMLElement & {
      shadowRoot: ShadowRoot;
    }>(
      '[data-role="editor-section-control"][data-setting="confirmation"] ha-notifications-setting-toggle',
    );
    const updatedConfirmationSwitch = updatedConfirmationToggle?.shadowRoot.querySelector<HTMLElement>(
      "ha-switch",
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
    await settleEditorNavigation(root);

    expect((confirmationSwitch as HTMLElement & { checked: boolean }).checked).toBe(
      false,
    );
    const resetConfirmationToggle = root.querySelector<HTMLElement & {
      shadowRoot: ShadowRoot;
    }>(
      '[data-role="editor-section-control"][data-setting="confirmation"] ha-notifications-setting-toggle',
    );
    const resetConfirmationSwitch = resetConfirmationToggle?.shadowRoot.querySelector<HTMLElement>(
      "ha-switch",
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
    await settleEditorNavigation(root);
    await user.click(queries.getAllByRole("button", { name: /Condition/ })[0]);
    const yamlEditor = root.querySelector<HTMLElement & { value: string }>(
      '[data-role="conditions-yaml-editor"]',
    );
    yamlEditor.value = "- true";
    await user.click(queries.getByRole("button", { name: "Validate condition" }));

    await vi.waitFor(() => {
      expect(
        root
          .querySelector("ha-notifications-toast-list")
          ?.shadowRoot?.querySelector(".nc-toast")?.textContent,
      ).toContain(
        "Conditions YAML must be a list of mappings.",
      );
    });
    expect(options.onValidateCondition).not.toHaveBeenCalled();
  });

  it("opens and closes the mobile section menu", async () => {
    const root = editorRoot();
    const user = testUser();
    openEditor(editorOptions(root));
    await settleEditorNavigation(root);

    const menuButton = root.querySelector<HTMLButtonElement>(
      ".nc-section-manage-button",
    );
    if (!menuButton) throw new Error("Section menu button is missing.");
    menuButton.style.display = "inline-grid";
    const menuButtonElement = menuButton.shadowRoot?.querySelector("button");
    if (!menuButtonElement) throw new Error("Section menu control is missing.");
    await user.click(menuButtonElement);
    await settleEditorNavigation(root);
    const menu = root.querySelector(
      "ha-notifications-editor-navigation[mode=mobile]",
    )?.shadowRoot?.querySelector(".nc-mobile-section-menu");

    expect(menu?.classList.contains("mobile-open")).toBe(true);
    expect(menuButton?.getAttribute("aria-expanded")).toBe("true");

    await user.click(menuButtonElement);
    await settleEditorNavigation(root);
    expect(menu?.classList.contains("mobile-open")).toBe(false);
    expect(menuButton?.getAttribute("aria-expanded")).toBe("false");
  });

  it("collapses and expands child section navigation", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    openEditor(editorOptions(root));
    await settleEditorNavigation(root);

    const navigation = root.querySelector(
      "ha-notifications-editor-navigation[mode=desktop]",
    );
    const childRows = () => [...(navigation?.shadowRoot?.querySelectorAll(
      '.nc-section-nav-row[data-parent="Confirmation"]',
    ) || [])];
    expect(childRows().length).toBeGreaterThan(0);
    expect(childRows().every((row) => !row.hasAttribute("hidden"))).toBe(true);

    await user.click(
      queries.getAllByRole("button", { name: "Collapse Confirmation subpanels" })[0],
    );
    await settleEditorNavigation(root);
    expect(childRows().every((row) => row.hasAttribute("hidden"))).toBe(true);

    await user.click(
      queries.getAllByRole("button", { name: "Expand Confirmation subpanels" })[0],
    );
    await settleEditorNavigation(root);
    expect(childRows().every((row) => !row.hasAttribute("hidden"))).toBe(true);
  });

  it("opens template help in a modal from the notification section", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    openEditor(editorOptions(root));
    await settleEditorNavigation(root);
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

    const editor = root.querySelector(
      ".nc-alert-yaml-modal ha-notifications-code-editor",
    ) as
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

    expect(
      stableMarkup(
        root
          .querySelector("ha-notifications-toast-list")
          ?.shadowRoot?.querySelector(".nc-toast") || null,
      ),
    ).toMatchSnapshot();
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

  it("confirms discarding unsaved changes inline without a modal", async () => {
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
    const confirmation = root.querySelector(".nc-discard-confirmation");
    expect(confirmation?.getAttribute("role")).toBe("group");
    expect(confirmation?.textContent?.replace(/\s+/g, " ").trim()).toContain(
      "You have unsaved changes. Leave without saving?",
    );
    expect(root.querySelector(".nc-modal-backdrop")).toBeNull();

    await user.click(queries.getByRole("button", { name: "Stay" }));
    expect(root.querySelector(".nc-editor-view")).not.toBeNull();
    expect(root.querySelector(".nc-discard-confirmation")).toBeNull();

    await user.click(queries.getByRole("button", { name: "Cancel" }));
    await user.click(queries.getByRole("button", { name: "Discard changes" }));
    expect(root.querySelector(".nc-editor-view")).toBeNull();
  });
});

describe("alert card actions", () => {
  it("dispatches supplied action IDs in a bubbling composed event", async () => {
    const alert = configuredAlertFixture();
    const card = document.createElement("ha-notifications-alert-card") as HTMLElement & {
      alert: typeof alert;
      actions: AlertActionItem[];
      hass: Hass | null;
      updateComplete: Promise<unknown>;
      shadowRoot: ShadowRoot;
    };
    card.alert = alert;
    card.actions = [{ id: "toggle", label: "Disable" }];
    card.hass = null;
    const parent = document.createElement("div");
    parent.append(card);
    document.body.append(parent);
    await card.updateComplete;

    let receivedEvent: CustomEvent<{ actionId: string; alert: typeof alert }> | undefined;
    parent.addEventListener("alert-action", (event) => {
      receivedEvent = event as CustomEvent<{ actionId: string; alert: typeof alert }>;
    });
    const actionButton = card.shadowRoot.querySelector("button");
    if (!actionButton) throw new Error("Alert action button is missing.");
    await testUser().click(actionButton);

    expect(receivedEvent?.detail).toEqual({ actionId: "toggle", alert });
    expect(receivedEvent?.bubbles).toBe(true);
    expect(receivedEvent?.composed).toBe(true);
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
    expect(picker.element.shadowRoot?.textContent).toContain("notify.missing");
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
    const pickerRoot = picker.element.shadowRoot;
    if (!pickerRoot) throw new Error("Recipient picker shadow root is missing.");
    const queries = domQueries(pickerRoot);
    const user = testUser();
    const search = pickerRoot.querySelector("ha-input") as HTMLElement;
    search.dispatchEvent(new Event("focus", { bubbles: true }));

    await user.click(queries.getByRole("button", { name: "Phone" }));

    expect(picker.target()).toMatchSnapshot();
    expect(
      stableMarkup(pickerRoot.querySelector(".nc-target-chip")),
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
    const pickerRoot = picker.element.shadowRoot;
    if (!pickerRoot) throw new Error("Recipient picker shadow root is missing.");
    const queries = domQueries(pickerRoot);
    const user = testUser();
    const search = pickerRoot.querySelector("ha-input") as HTMLElement & {
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