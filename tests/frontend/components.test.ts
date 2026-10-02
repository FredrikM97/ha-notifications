// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import {
  button,
  buttonComponent,
  buttonComponentStyles,
} from "../../frontend/components/button.js";
import { defaultAlert } from "../../frontend/editor/alert-defaults.js";
import {
  openEditor,
  updateOpenEditorHass,
} from "../../frontend/editor/index.js";
import { helpTooltipStyles } from "../../frontend/editor/section.js";
import { editorSections } from "../../frontend/editor/types.js";
import { createRecipientPicker } from "../../frontend/components/recipient-picker.js";
import "../../frontend/panel/alert-card.js";
import type { AlertActionItem } from "../../frontend/panel/alert-card/actions.js";
import type { Hass } from "../../frontend/types.js";
import {
  editorAlertFixture,
  cleanupTestDom,
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
  settleLitTree,
  testUser,
} from "./conftest.js";

installHaTestElements();

afterEach(cleanupTestDom);

function nestedQuery(container: ParentNode, selector: string): Element[] {
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
}

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
    help: nestedQuery(contentRoot, '[role="tooltip"]').map(text),
  };
}

describe("alert editor interactions", () => {
  it("updates native selector context when Home Assistant replaces hass", async () => {
    const root = editorRoot();
    const options = editorOptions(root);
    const replacementHass = {
      ...options.hass,
      connection: { sendMessagePromise: vi.fn() },
    } as Hass;
    openEditor(options);

    const triggerEditor = nestedQuery(
      root,
      'ha-notifications-code-editor[data-role="triggers-yaml-editor"]',
    )[0] as HTMLElement & { shadowRoot: ShadowRoot };
    const visualButton = [...triggerEditor.shadowRoot.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Visual");
    visualButton?.click();
    await settleLitTree(triggerEditor.shadowRoot);

    updateOpenEditorHass(root, replacementHass);
    await settleLitTree(root);

    const triggerSelector = nestedQuery(
      root,
      'ha-selector[data-role="native-visual-selector"]',
    )[0] as (HTMLElement & { hass?: Hass }) | undefined;
    expect(triggerSelector?.hass).toBe(replacementHass);
  });

  it("spaces startup and periodic condition checks", () => {
    const root = editorRoot();
    openEditor(editorOptions(root));

    const conditionSection = nestedQuery(
      root,
      'ha-notifications-editor-section[data-title="Conditions"]',
    )[0];
    const spacingStyles = conditionSection?.shadowRoot?.querySelector("style")
      ?.textContent;

    expect(spacingStyles).toContain(".nc-condition-setting");
    expect(spacingStyles).toContain("gap: 16px");
  });

  it("places startup and periodic checks in Conditions, not Triggers", () => {
    const root = editorRoot();
    openEditor(editorOptions(root));

    const conditionSection = nestedQuery(
      root,
      'ha-notifications-editor-section[data-title="Conditions"]',
    )[0];
    const triggerSection = nestedQuery(
      root,
      'ha-notifications-editor-section[data-title="Triggers"]',
    )[0];
    const conditionRoot = conditionSection?.shadowRoot || document;
    const triggerRoot = triggerSection?.shadowRoot || document;

    expect(
      nestedQuery(conditionRoot, 'ha-switch[aria-label="Check at startup"]'),
    ).toHaveLength(1);
    expect(
      (nestedQuery(
        conditionRoot,
        'ha-switch[aria-label="Check at startup"]',
      )[0] as HTMLElement & { checked: boolean }).checked,
    ).toBe(false);
    expect(
      nestedQuery(conditionRoot, 'ha-switch[data-role="interval-toggle"]'),
    ).toHaveLength(1);
    expect(
      nestedQuery(triggerRoot, 'ha-switch[aria-label="Check at startup"]'),
    ).toHaveLength(0);
    expect(
      nestedQuery(triggerRoot, 'ha-switch[data-role="interval-toggle"]'),
    ).toHaveLength(0);
  });

  it("shows an example condition in the empty YAML editor", () => {
    const root = editorRoot();
    openEditor(editorOptions(root));

    const conditionSection = nestedQuery(
      root,
      'ha-notifications-editor-section[data-title="Conditions"]',
    )[0];
    const editor = nestedQuery(
      conditionSection?.shadowRoot || document,
      '[data-role="conditions-yaml-editor"]',
    )[0] as HTMLElement & { placeholder: string };

    expect(editor.placeholder).toBe(
      '- condition: state\n  entity_id: binary_sensor.front_door\n  state: "on"',
    );
  });

  it("places trigger and condition tooltips beside their field labels", () => {
    const root = editorRoot();
    openEditor(editorOptions(root));

    for (const [sectionTitle, editorRole] of [
      ["Triggers", "triggers-yaml-editor"],
      ["Conditions", "conditions-yaml-editor"],
    ]) {
      const section = nestedQuery(
        root,
        `ha-notifications-editor-section[data-title="${sectionTitle}"]`,
      )[0];
      const fields = nestedQuery(
        section?.shadowRoot || document,
        "ha-notifications-form-field",
      );
      const field = fields.find((candidate) =>
        candidate.querySelector(`[data-role="${editorRole}"]`),
      );
      const label = field?.querySelector('[slot="label"]');
      const button = label && nestedQuery(label, ".nc-help-tooltip")[0] as HTMLButtonElement | undefined;
      const tooltip = label && nestedQuery(label, '[role="tooltip"]')[0] as HTMLElement | undefined;

      expect(button).not.toBeNull();
      expect(button?.getAttribute("aria-describedby")).toBe(tooltip?.id);
      expect(button?.title).toBe("");
      expect(tooltip?.textContent).toBeTruthy();
    }

    const conditionSection = nestedQuery(
      root,
      'ha-notifications-editor-section[data-title="Conditions"]',
    )[0];
    expect(
      nestedQuery(conditionSection?.shadowRoot || document, ".nc-help-tooltip"),
    ).toHaveLength(2);
    const triggerSection = nestedQuery(
      root,
      'ha-notifications-editor-section[data-title="Triggers"]',
    )[0];
    expect(
      nestedQuery(triggerSection?.shadowRoot || document, ".nc-help-tooltip"),
    ).toHaveLength(2);
    const builtInTriggerSection = nestedQuery(
      root,
      'ha-notifications-editor-section[data-title="When to run"]',
    )[0];
    expect(
      nestedQuery(builtInTriggerSection?.shadowRoot || document, ".nc-help-tooltip"),
    ).toHaveLength(2);
  });

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

  it("makes conditions optional and explains how they gate triggers", async () => {
    const alert = defaultAlert();
    expect(alert.conditions).toEqual([]);

    const root = editorRoot();
    openEditor(editorOptions(root, alert));
    expect(
      sectionContract(root.querySelector('[data-title="Conditions"]'))?.help?.some(
        (help) => help.startsWith("Conditions are optional and gate every trigger"),
      ),
    ).toBe(true);
  });

  it.each([
    {
      trigger: { trigger: "homeassistant", event: "start" },
      label: "Check at startup",
    },
    {
      trigger: { trigger: "time_pattern", hours: "/12" },
      label: "Enable periodic condition checks",
    },
  ])("allows $label without conditions", async ({ trigger, label }) => {
    const alert = defaultAlert();
    alert.conditions = [];
    alert.triggers = [trigger];
    const root = editorRoot();
    openEditor(editorOptions(root, alert));

    expect(nestedQuery(root, '[data-title="Conditions"] [role="status"]')).toHaveLength(0);
    expect(
      nestedQuery(
        root,
        `[data-title="Conditions"] ha-switch[aria-label="${label}"]`,
      )[0],
    ).toMatchObject({ checked: true });
  });

  it("explains inactive cancellation beside When to run", async () => {
    const root = editorRoot();
    openEditor(editorOptions(root));

    expect(
      sectionContract(root.querySelector('[data-title="When to run"]'))?.help,
    ).toContain(
      "Cancel confirmation waits when Conditions become false or a configured on/off state trigger reaches its inverse state.",
    );
  });

  it("shows the content control matching the selected optional section", async () => {
    const root = editorRoot();
    const user = testUser();
    openEditor(editorOptions(root));
    await settleEditorNavigation(root);

    const contentControls = root.querySelector<HTMLElement>(
      ".nc-editor-section-controls",
    );
    expect(contentControls?.hidden).toBe(true);
    expect(
      root.querySelector(".nc-editor-header [data-role=\"editor-section-control\"]"),
    ).toBeNull();

    for (const { title, setting } of editorSections.filter(
      (section) => section.setting,
    )) {
      const navigationButton = [...root.querySelectorAll<HTMLButtonElement>(
        ".nc-section-nav-button",
      )].find((button) => button.textContent?.includes(title));
      expect(navigationButton).toBeDefined();
      await user.click(navigationButton!);
      await settleEditorNavigation(root);
      expect(contentControls?.hidden).toBe(false);

      for (const control of root.querySelectorAll<HTMLElement>(
        '[data-role="editor-section-control"]',
      )) {
        expect(control.hidden).toBe(control.dataset.setting !== setting);
      }
    }
  });

  it("places post-send help beside the enable label", async () => {
    const root = editorRoot();
    const user = testUser();
    const alert = defaultAlert();
    alert.post_send_actions = { enabled: true };
    openEditor(editorOptions(root, alert));
    await settleEditorNavigation(root);

    const navigationButton = [...root.querySelectorAll<HTMLButtonElement>(
      ".nc-section-nav-button",
    )].find((button) => button.textContent?.includes("Post-send actions"));
    expect(navigationButton).toBeDefined();
    await user.click(navigationButton!);
    await settleEditorNavigation(root);

    const toggle = nestedQuery(
      root,
      '[data-role="editor-section-control"][data-setting="postSendActions"] ha-notifications-setting-toggle',
    )[0] as HTMLElement & { shadowRoot: ShadowRoot };
    const helperSlot = toggle.querySelector('[slot="help"]');
    const labelSlot = toggle.shadowRoot.querySelector('.label slot[name="help"]');
    const switchElement = toggle.shadowRoot.querySelector("ha-switch");
    const postSendSection = nestedQuery(
      root,
      'ha-notifications-editor-section[data-title="Post-send actions"]',
    )[0];

    expect(helperSlot).not.toBeNull();
    expect(nestedQuery(helperSlot!, ".nc-help-tooltip")).toHaveLength(1);
    expect(labelSlot).not.toBeNull();
    expect(toggle.shadowRoot.querySelector(".label")?.textContent).toContain(
      "Enable Post-send actions",
    );
    expect(switchElement?.getAttribute("aria-label")).toBe(
      "Enable Post-send actions",
    );
    expect(
      nestedQuery(postSendSection?.shadowRoot || document, ".nc-help-tooltip"),
    ).toHaveLength(0);
  });

      it("places confirmation option help beside each enable label", async () => {
        const root = editorRoot();
        openEditor(editorOptions(root));
        await settleEditorNavigation(root);

        for (const [sectionName, settingName] of [
          ["Notify recipients when confirmed", "confirmationNotification"],
          ["Post-confirmation actions", "postConfirmationActions"],
        ]) {
          const navigationButton = [...root.querySelectorAll<HTMLButtonElement>(
            ".nc-section-nav-button",
          )].find((button) => button.textContent?.includes(sectionName));
          expect(navigationButton).toBeDefined();
          await testUser().click(navigationButton!);
          await settleEditorNavigation(root);

          const toggle = nestedQuery(
            root,
            `[data-role="editor-section-control"][data-setting="${settingName}"] ha-notifications-setting-toggle`,
          )[0] as HTMLElement & { shadowRoot: ShadowRoot };
          const helper = toggle.querySelector('[slot="help"]');
          const helperSlot = toggle.shadowRoot.querySelector('.label slot[name="help"]');
          expect(helper).not.toBeNull();
          expect(helperSlot).not.toBeNull();
          expect(
            nestedQuery(helper!, ".nc-help-tooltip"),
          ).toHaveLength(1);

          const section = nestedQuery(
            root,
            `ha-notifications-editor-section[data-title="${sectionName}"]`,
          )[0];
          if (settingName === "postConfirmationActions") {
            expect(nestedQuery(section?.shadowRoot || document, ".nc-help-tooltip"))
              .toHaveLength(0);
          }
        }
      });

      it("groups condition checks under Conditions and cancellation under Triggers", async () => {
        const root = editorRoot();
        openEditor(editorOptions(root));
        await settleEditorNavigation(root);

        const triggerSection = nestedQuery(
          root,
          'ha-notifications-editor-section[data-title="Triggers"]',
        )[0];
        const conditionsSection = nestedQuery(
          root,
          'ha-notifications-editor-section[data-title="Conditions"]',
        )[0];
        const whenToRunSection = nestedQuery(
          root,
          'ha-notifications-editor-section[data-title="When to run"]',
        )[0];
        expect(nestedQuery(triggerSection?.shadowRoot || document, 'ha-switch[aria-label="Check at startup"]'))
          .toHaveLength(0);
        expect(nestedQuery(triggerSection?.shadowRoot || document, 'ha-switch[aria-label="Enable periodic condition checks"]'))
          .toHaveLength(0);
        expect(nestedQuery(conditionsSection?.shadowRoot || document, 'ha-switch[aria-label="Check at startup"]'))
          .toHaveLength(1);
        expect(nestedQuery(conditionsSection?.shadowRoot || document, 'ha-switch[aria-label="Enable periodic condition checks"]'))
          .toHaveLength(1);
        expect(nestedQuery(triggerSection?.shadowRoot || document, 'ha-switch[aria-label="Cancel on inactive"]'))
          .toHaveLength(0);
        expect(nestedQuery(whenToRunSection?.shadowRoot || document, 'ha-switch[aria-label="Cancel on inactive"]'))
          .toHaveLength(1);
        const whenToRunFields = nestedQuery(
          whenToRunSection?.shadowRoot || document,
          "ha-notifications-form-field",
        );
        const cancelField = whenToRunFields.find((field) =>
          field.querySelector('ha-switch[aria-label="Cancel on inactive"]'),
        );
        expect(
          nestedQuery(whenToRunSection?.shadowRoot || document, 'ha-switch[aria-label="Cancel on inactive"]')[0]
            .hasAttribute("disabled"),
        ).toBe(false);
        expect(cancelField).toBeDefined();
        expect(nestedQuery(whenToRunSection?.shadowRoot || document, "ha-switch"))
          .toHaveLength(1);
      });

      it("refreshes section status when a startup check is enabled", async () => {
        const alert = defaultAlert();
        alert.conditions = [{
          condition: "state",
          entity_id: "binary_sensor.door",
          state: "on",
        }];
        alert.triggers = [];
        const root = editorRoot();
        openEditor(editorOptions(root, alert));
        await settleEditorNavigation(root);

        const initialConditionsMarker = nestedQuery(
          root,
          '.nc-section-status[data-status="conditions"]',
        )[0];
        const initialTriggersMarker = nestedQuery(
          root,
          '.nc-section-status[data-status="triggers"]',
        )[0];
        expect(initialConditionsMarker.classList.contains("active")).toBe(false);
        expect(initialTriggersMarker.classList.contains("active")).toBe(false);

        const startupSwitch = nestedQuery(
          root,
          'ha-switch[aria-label="Check at startup"]',
        )[0] as HTMLElement & { checked: boolean };
        startupSwitch.checked = true;
        startupSwitch.dispatchEvent(new Event("change", { bubbles: true }));

        const conditionsMarker = nestedQuery(
          root,
          '.nc-section-status[data-status="conditions"]',
        )[0];
        const triggersMarker = nestedQuery(
          root,
          '.nc-section-status[data-status="triggers"]',
        )[0];
        expect(conditionsMarker.classList.contains("active")).toBe(true);
        expect(triggersMarker.classList.contains("active")).toBe(false);
      });

      it("marks unused and configured Conditions and Triggers", () => {
        const noChecksAlert = defaultAlert();
        noChecksAlert.conditions = [{
          condition: "state",
          entity_id: "binary_sensor.door",
          state: "on",
        }];
        noChecksAlert.triggers = [];
        const emptyRoot = editorRoot();
        openEditor(editorOptions(emptyRoot, noChecksAlert));

        for (const status of ["conditions", "triggers"]) {
          const markers = nestedQuery(
            emptyRoot,
            `.nc-section-status[data-status="${status}"]`,
          );
          expect(markers.length).toBeGreaterThan(0);
          expect(markers.every((marker) =>
            !marker.classList.contains("active") &&
            marker.textContent?.trim() === "×" &&
            marker.getAttribute("aria-label") === "Disabled",
          )).toBe(true);
        }

        const scheduleOnlyAlert = defaultAlert();
        scheduleOnlyAlert.conditions = [{
          condition: "state",
          entity_id: "binary_sensor.door",
          state: "on",
        }];
        scheduleOnlyAlert.triggers = [{
          trigger: "homeassistant",
          event: "start",
        }];
        const scheduleOnlyRoot = editorRoot();
        openEditor(editorOptions(scheduleOnlyRoot, scheduleOnlyAlert));
        const conditionsMarker = nestedQuery(
          scheduleOnlyRoot,
          '.nc-section-status[data-status="conditions"]',
        )[0];
        const triggersMarker = nestedQuery(
          scheduleOnlyRoot,
          '.nc-section-status[data-status="triggers"]',
        )[0];
        expect(conditionsMarker.classList.contains("active")).toBe(true);
        expect(triggersMarker.classList.contains("active")).toBe(false);

        const intervalOnlyAlert = defaultAlert();
        intervalOnlyAlert.conditions = [{
          condition: "state",
          entity_id: "binary_sensor.door",
          state: "on",
        }];
        intervalOnlyAlert.triggers = [{
          trigger: "time_pattern",
          hours: "/12",
        }];
        const intervalOnlyRoot = editorRoot();
        openEditor(editorOptions(intervalOnlyRoot, intervalOnlyAlert));
        const intervalConditionsMarker = nestedQuery(
          intervalOnlyRoot,
          '.nc-section-status[data-status="conditions"]',
        )[0];
        const intervalTriggersMarker = nestedQuery(
          intervalOnlyRoot,
          '.nc-section-status[data-status="triggers"]',
        )[0];
        expect(intervalConditionsMarker.classList.contains("active")).toBe(true);
        expect(intervalTriggersMarker.classList.contains("active")).toBe(false);

        const configuredAlert = defaultAlert();
        configuredAlert.conditions = [{
          condition: "state",
          entity_id: "binary_sensor.door",
          state: "on",
        }];
        configuredAlert.on_condition_change = true;
        configuredAlert.triggers = [];
        const configuredRoot = editorRoot();
        openEditor(editorOptions(configuredRoot, configuredAlert));

        for (const status of ["conditions", "triggers"]) {
          const markers = nestedQuery(
            configuredRoot,
            `.nc-section-status[data-status="${status}"]`,
          );
          expect(markers.length).toBeGreaterThan(0);
          expect(markers.every((marker) =>
            marker.classList.contains("active") &&
            marker.textContent?.trim() === "✓" &&
            marker.getAttribute("aria-label") === "Enabled",
          )).toBe(true);
        }
      });

      it("places structured template help beside Message", () => {
        const root = editorRoot();
        openEditor(editorOptions(root));

        const notificationSection = nestedQuery(
          root,
          'ha-notifications-editor-section[data-title="Notification"]',
        )[0];
        const messageField = nestedQuery(
          notificationSection?.shadowRoot || document,
          "ha-notifications-form-field",
        ).find((field) =>
          field.querySelector('[slot="label"]')?.textContent?.includes("Message"),
        );
        const label = messageField?.querySelector('[slot="label"]');
        const tooltip = label && nestedQuery(label, '[role="tooltip"]')[0];
        expect(label?.textContent).toContain("Message");
        expect(tooltip?.textContent).toContain("Use condition results");
        expect(tooltip?.textContent).toContain("Available values");
        expect(tooltip?.textContent).toContain("Home Assistant templates");
        expect(
          nestedQuery(notificationSection?.shadowRoot || document, ".nc-template-help-trigger"),
        ).toHaveLength(0);
      });

      it("places recipient guidance beside the Selected recipients label", () => {
    const root = editorRoot();
    openEditor(editorOptions(root));

    const picker = nestedQuery(
      root,
      'ha-notifications-editor-section[data-title="Recipients"] ha-notifications-recipient-picker',
    )[0];
    const pickerRoot = picker?.shadowRoot;
    const heading = pickerRoot?.querySelector(".nc-target-selection-heading");

    expect(heading?.querySelector(".nc-target-selection-label")?.textContent).toBe(
      "Selected recipients",
    );
    expect(nestedQuery(heading || document, ".nc-help-tooltip")).toHaveLength(1);
    expect(
      nestedQuery(heading || document, '[role="tooltip"]')[0]?.textContent,
    ).toContain("standard Notify service");
    expect(nestedQuery(pickerRoot || document, ".nc-help-tooltip")).toHaveLength(1);
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

  it("explains confirmation timeout and exposes its editable duration when enabled", async () => {
    const root = editorRoot();
    const user = testUser();
    openEditor(editorOptions(root, defaultAlert()));
    await settleEditorNavigation(root);

    const confirmationButton = [...root.querySelectorAll<HTMLButtonElement>(
      ".nc-section-nav-button",
    )].find((button) => button.textContent?.includes("Confirmation"));
    expect(confirmationButton).toBeDefined();
    await user.click(confirmationButton!);
    await settleEditorNavigation(root);

    const section = root.querySelector<HTMLElement>('.nc-section[data-title="Confirmation"]');
    const sectionRoot = section?.shadowRoot;
    const options = sectionRoot?.querySelector(".nc-confirmation-timeout-options");
    expect(options).not.toBeNull();
    expect(nestedQuery(sectionRoot!, 'button[aria-label="More information"]')).toHaveLength(1);
    expect(nestedQuery(sectionRoot!, '[role="tooltip"]')[0]?.textContent).toContain(
      "does not change the reminder interval or maximum reminders",
    );

    const timeoutSwitch = options?.querySelector("ha-switch") as
      | (HTMLElement & { checked: boolean })
      | null;
    if (!timeoutSwitch) throw new Error("Confirmation timeout switch is missing.");
    timeoutSwitch.checked = true;
    timeoutSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    const editor = root.querySelector<HTMLElement & { shadowRoot: ShadowRoot }>(
      "ha-notifications-alert-editor",
    );
    if (!editor) throw new Error("Alert editor component is missing.");
    await settleLitTree(editor.shadowRoot);

    const timeoutField = nestedQuery(
      editor.shadowRoot,
      ".nc-confirmation-timeout-field",
    )[0];
    expect(timeoutField).not.toBeNull();
    const timeoutDuration = timeoutField.querySelector(
      'ha-notifications-duration-input[aria-label="Confirmation timeout"]',
    );
    expect(timeoutDuration).not.toBeNull();
    const selector = timeoutDuration?.shadowRoot?.querySelector("ha-selector");
    expect(selector).not.toBeNull();
    const durationChanges: string[] = [];
    timeoutDuration?.addEventListener("nc-duration-change", (event) => {
      durationChanges.push((event as CustomEvent<{ value: string }>).detail.value);
    });
    selector?.dispatchEvent(new CustomEvent("value-changed", {
      detail: { value: { days: 0, hours: 0, minutes: 10, seconds: 0 } },
      bubbles: true,
      composed: true,
    }));
    expect(durationChanges).toEqual(["00:10:00"]);

    const reminderButton = [...root.querySelectorAll<HTMLButtonElement>(
      ".nc-section-nav-button",
    )].find((button) => button.textContent?.includes("Reminder policy"));
    expect(reminderButton).toBeDefined();
    await user.click(reminderButton!);
    await settleLitTree(editor.shadowRoot);
    const reminderRoot = nestedQuery(
      editor.shadowRoot,
      '.nc-section[data-title="Reminder policy"]',
    )[0]?.shadowRoot;
    expect(
      nestedQuery(reminderRoot || document, '[aria-label="Confirmation timeout"]'),
    ).toHaveLength(0);
    expect(
      nestedQuery(
        reminderRoot || document,
        ".nc-reminder-options ha-switch[aria-label='Show attempt count in notification title']",
      ),
    ).toHaveLength(1);
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

  it("saves the selected automation mode", async () => {
    const root = editorRoot();
    const alert = draftAlertFixture({
      name: "Mode selection",
      automation_mode: "restart",
      conditions: [{
        condition: "state",
        entity_id: "binary_sensor.door",
        state: "on",
      }],
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

    const whenToRunSection = nestedQuery(
      root,
      'ha-notifications-editor-section[data-title="When to run"]',
    )[0];
    expect(
      nestedQuery(
        whenToRunSection?.shadowRoot || whenToRunSection || root,
        '[data-role="automation-mode"]',
      ),
    ).toHaveLength(1);
    const modeSelector = root.querySelector<HTMLElement & {
      selector: { select: { options: { value: string }[] } };
      value: string;
    }>('[data-role="automation-mode"]');
    expect(modeSelector?.selector.select.options.map(({ value }) => value)).toEqual([
      "single",
      "restart",
      "queued",
      "parallel",
    ]);
    if (!modeSelector) throw new Error("Automation mode selector is missing.");

    const inactiveSwitch = root.querySelector<HTMLElement & { checked: boolean }>(
      '[aria-label="Cancel on inactive"]',
    );
    expect(inactiveSwitch?.checked).toBe(false);
    if (!inactiveSwitch) throw new Error("Cancel-on-inactive switch is missing.");
    inactiveSwitch.checked = true;
    inactiveSwitch.dispatchEvent(new Event("change", { bubbles: true }));

    modeSelector.value = "parallel";
    modeSelector.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: "parallel" },
        bubbles: true,
        composed: true,
      }),
    );
    await testUser().click(
      editorQueries(root).getByRole("button", { name: "Save alert" }),
    );
    await vi.waitFor(() => expect(options.onSave).toHaveBeenCalledOnce());

    expect(options.onSave.mock.calls[0][0].automation_mode).toBe("parallel");
    expect(options.onSave.mock.calls[0][0].conditions).toEqual([{
      condition: "state",
      entity_id: "binary_sensor.door",
      state: "on",
    }]);
    expect(options.onSave.mock.calls[0][0].cancel_on_inactive).toBe(true);
  });

  it("keeps built-in triggers out of Triggers YAML and merges custom YAML on save", async () => {
    const root = editorRoot();
    const user = testUser();
    const alert = draftAlertFixture({
      name: "Sensor alert",
      on_condition_change: true,
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

  it("enables condition-change triggers in the Triggers section", async () => {
    const root = editorRoot();
    const user = testUser();
    const alert = configuredAlertFixture({
      on_condition_change: false,
      conditions: [{
        condition: "state",
        entity_id: "binary_sensor.front_door",
        state: "on",
      }],
    });
    const options = editorOptions(root, alert);
    openEditor(options);
    await settleEditorNavigation(root);

    const navigationButton = [...root.querySelectorAll<HTMLButtonElement>(
      ".nc-section-nav-button",
    )].find((button) => button.textContent?.includes("Triggers"));
    expect(navigationButton).toBeDefined();
    await user.click(navigationButton!);
    await settleEditorNavigation(root);

    const onChangeSwitch = root.querySelector<HTMLElement & { checked: boolean }>(
      'ha-notifications-editor-section[data-title="Triggers"] ha-switch[aria-label="When conditions change"]',
    );
    expect(onChangeSwitch?.checked).toBe(false);
    if (!onChangeSwitch) throw new Error("Condition-change switch is missing.");
    onChangeSwitch.checked = true;
    onChangeSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    await user.click(editorQueries(root).getByRole("button", { name: "Save alert" }));
    await vi.waitFor(() => expect(options.onSave).toHaveBeenCalledOnce());

    expect(options.onSave.mock.calls[0][0].on_condition_change).toBe(true);
  });

  it("keeps custom trigger YAML editable but excludes it when the option is off", async () => {
    const root = editorRoot();
    const user = testUser();
    const alert = configuredAlertFixture({
      on_condition_change: false,
      triggers: [
        { trigger: "homeassistant", event: "start" },
        { trigger: "state", entity_id: "binary_sensor.front_door" },
      ],
    });
    const options = editorOptions(root, alert);
    openEditor(options);
    await settleEditorNavigation(root);

    const triggerMarker = nestedQuery(
      root,
      '.nc-section-status[data-status="triggers"]',
    )[0];
    const triggersEditor = root.querySelector<HTMLElement & {
      readOnly: boolean;
      value: string;
    }>("[data-role=\"triggers-yaml-editor\"]");
    expect(triggerMarker.classList.contains("active")).toBe(false);
    expect(triggersEditor?.readOnly).toBe(false);
    expect(triggersEditor?.value).toContain("binary_sensor.front_door");
    if (!triggersEditor) throw new Error("Triggers YAML editor is missing.");
    triggersEditor.value = "- trigger: state\n  entity_id: binary_sensor.edited\n";
    triggersEditor.dispatchEvent(new Event("input", { bubbles: true }));
    expect(triggersEditor.value).toContain("binary_sensor.edited");

    const onChangeSwitch = root.querySelector<HTMLElement & { checked: boolean }>(
      'ha-notifications-editor-section[data-title="Triggers"] ha-switch[aria-label="When conditions change"]',
    );
    if (!onChangeSwitch) throw new Error("Condition-change switch is missing.");
    onChangeSwitch.checked = true;
    onChangeSwitch.dispatchEvent(new Event("change", { bubbles: true }));

    expect(triggerMarker.classList.contains("active")).toBe(true);

    onChangeSwitch.checked = false;
    onChangeSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    expect(triggerMarker.classList.contains("active")).toBe(false);

    await user.click(editorQueries(root).getByRole("button", { name: "Save alert" }));
    await vi.waitFor(() => expect(options.onSave).toHaveBeenCalledOnce());
    expect(options.onSave.mock.calls[0][0].triggers).toEqual([
      { trigger: "homeassistant", event: "start" },
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

    const helpTooltip = notificationToggle?.querySelector("ha-notifications-help-tooltip");
    const helpContent = helpTooltip?.shadowRoot?.querySelector('[role="tooltip"]')?.textContent;
    expect(helpContent).toContain(
      "Optionally send a follow-up notification to alert recipients after one recipient confirms the alert.",
    );
    expect(helpContent).toContain("confirmed_by");
    expect(
      root.querySelector(
        'ha-notifications-editor-section[data-title="Notify recipients when confirmed"] ha-notifications-help-tooltip',
      ),
    ).toBeNull();
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
      "Enable confirmation",
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
    await user.click(queries.getByRole("button", { name: "Validate conditions" }));

    await vi.waitFor(() => {
      expect(
        root
          .querySelector("ha-notifications-toast-list")
          ?.shadowRoot?.querySelector(".nc-toast")?.textContent,
      ).toContain(
        "Conditions YAML must be a list of mappings.",
      );
    });
    expect(options.onValidateAlert).not.toHaveBeenCalled();
  });

  it("validates the edited trigger list through Home Assistant", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    const options = editorOptions(root, {
      ...defaultAlert(),
      on_condition_change: true,
    });
    openEditor(options);
    await settleEditorNavigation(root);
    const triggerButton = [...root.querySelectorAll<HTMLButtonElement>(
      ".nc-section-nav-button",
    )].find((button) =>
      button.querySelector(".nc-section-nav-button > span:last-child")
        ?.textContent?.trim() === "Triggers",
    );
    expect(triggerButton).toBeDefined();
    await user.click(triggerButton!);
    await settleEditorNavigation(root);

    const triggerEditor = root.querySelector<HTMLElement & { value: string }>(
      '[data-role="triggers-yaml-editor"]',
    );
    triggerEditor.value = '- trigger: state\n  entity_id: binary_sensor.front_door\n  to: "on"';
    triggerEditor.dispatchEvent(new Event("input", { bubbles: true }));
    await user.click(queries.getByRole("button", { name: "Validate triggers" }));

    await vi.waitFor(() => expect(options.onValidateAlert).toHaveBeenCalledOnce());
    expect(options.onValidateAlert.mock.calls[0][0].triggers).toContainEqual({
      trigger: "state",
      entity_id: "binary_sensor.front_door",
      to: "on",
    });
    expect(
      root
        .querySelector("ha-notifications-toast-list")
        ?.shadowRoot?.querySelector(".nc-toast")?.textContent,
    ).toContain("Triggers are valid.");
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

  it("shows rich template guidance in the shared tooltip", async () => {
    const root = editorRoot();
    const queries = editorQueries(root);
    const user = testUser();
    openEditor(editorOptions(root));
    await settleEditorNavigation(root);
    await user.click(queries.getAllByRole("button", { name: /Notification/ })[0]);

    const tooltipComponent = nestedQuery(root, "ha-notifications-help-tooltip")
      .find((element) =>
        element.shadowRoot?.textContent?.includes("condition.front_door"),
      ) as HTMLElement & { shadowRoot: ShadowRoot } | undefined;
    expect(tooltipComponent).toBeDefined();
    if (!tooltipComponent) throw new Error("Template help tooltip is missing.");
    await settleLitTree(tooltipComponent.shadowRoot);

    const tooltip = tooltipComponent.shadowRoot.querySelector<HTMLElement>(
      '[role="tooltip"]',
    );
    const helperButton = tooltipComponent.shadowRoot.querySelector<HTMLButtonElement>(
      "button",
    );
    expect(helperButton).not.toBeNull();
    if (!helperButton || !tooltip) throw new Error("Template help controls are missing.");

    const popup = tooltip as HTMLElement & { showPopover?: () => void };
    popup.showPopover = () => {
      throw new Error("Use the fallback popover path in this test.");
    };
    await user.hover(helperButton);
    expect(tooltip?.getAttribute("popover")).toBe("manual");
    expect(tooltip?.classList.contains("fallback-open")).toBe(true);
    expect(tooltip?.textContent).toContain("condition.front_door");
    expect(tooltip?.textContent).toContain("states('sensor.temperature')");
    expect(root.querySelector(".nc-template-help-modal")).toBeNull();
    expect(helpTooltipStyles.cssText).toContain("display: none;");
    expect(helpTooltipStyles.cssText).toContain("position: fixed;");
    expect(helpTooltipStyles.cssText).toContain("max-height: min(55vh, 480px);");
    helperButton.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(tooltip.classList.contains("fallback-open")).toBe(false);
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

  it("confirms discarding unsaved changes in a modal", async () => {
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
    const confirmation = root.querySelector(".nc-discard-modal");
    expect(confirmation?.textContent?.replace(/\s+/g, " ").trim()).toContain(
      "You have unsaved changes. Leave without saving?",
    );
    expect(root.querySelector(".nc-modal-backdrop")).not.toBeNull();

    const stayButton = root
      .querySelector<HTMLElement & { shadowRoot: ShadowRoot }>(
        ".nc-discard-actions ha-notifications-button",
      )
      ?.shadowRoot.querySelector("button");
    if (!stayButton) throw new Error("Stay button is missing.");
    await user.click(stayButton);
    expect(root.querySelector(".nc-editor-view")).not.toBeNull();
    expect(root.querySelector(".nc-discard-modal")).toBeNull();

    await user.click(queries.getByRole("button", { name: "Cancel" }));
    const discardButtons = root
      .querySelector(".nc-discard-actions")
      ?.querySelectorAll<HTMLElement & { shadowRoot: ShadowRoot }>(
        "ha-notifications-button",
      );
    const discardButton = discardButtons?.[1]?.shadowRoot.querySelector("button");
    if (!discardButton) throw new Error("Discard button is missing.");
    await user.click(discardButton);
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