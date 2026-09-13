import { errorMessage } from "./api";
import { actionButton, checkbox, conditionFromAlert, createField, createYamlEditor, clone, defaultAlert, input, sectionPanel, switchToggle, targetFromAlert, textarea, toYaml } from "./dom";
import { createRecipientPicker } from "./recipient-picker.ts";
import { visualConditionBuilder } from "./condition-builder.ts";

function showAlertYaml(root, alert) {
  const backdrop = document.createElement("div");
  backdrop.className = "nc-modal-backdrop";

  const modal = document.createElement("div");
  modal.className = "nc-modal nc-alert-yaml-modal";

  const header = document.createElement("div");
  header.className = "nc-modal-header";

  const title = document.createElement("h2");
  title.textContent = "Alert YAML";

  const close = actionButton("Back to editor");
  header.append(title, close);

  const body = document.createElement("div");
  body.className = "nc-modal-body";

  const editor = createYamlEditor(toYaml(alert), true);
  editor.classList.add("nc-alert-yaml-editor");

  const help = document.createElement("div");
  help.className = "nc-help";
  help.textContent = "This is a read-only view of the alert currently being edited.";

  body.append(help, editor);
  modal.append(header, body);
  backdrop.append(modal);
  root.append(backdrop);

  const closeView = () => backdrop.remove();
  close.addEventListener("click", closeView);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeView();
  });
}

export function openEditor({
  root,
  alert,
  registries,
  onSave,
  onTest,
  onCancel,
}: {
  root: ShadowRoot;
  alert?: any;
  registries: any;
  onSave: (alert: any) => Promise<void>;
  onTest: (alertId: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const value = clone(
    alert || defaultAlert(),
  );

  value.notification = {
    ...(value.notification || {}),
    confirmation: {
      ...(value.notification?.confirmation || {}),
    },
  };

  const backdrop =
    document.createElement(
      "div",
    );

  backdrop.className =
    "nc-editor-view";

  const page = root.querySelector<HTMLElement>(
    ".nc-page",
  );

  if (page) {
    page.hidden = true;
  }

  const modal =
    document.createElement(
      "div",
    );

  modal.className =
    "nc-editor-shell";

  const header =
    document.createElement(
      "div",
    );

  header.className =
    "nc-modal-header";

  const heading =
    document.createElement(
      "h2",
    );

  heading.textContent =
    value.id
      ? "Edit alert"
      : "Add alert";

  const close =
    actionButton(
      "Back to alerts",
    );

  header.append(
    heading,
    close,
  );

  const body =
    document.createElement(
      "div",
    );

  body.className =
    "nc-modal-body";

  let dirty = false;

  const markDirty = () => {
    dirty = true;
  };

  const footer =
    document.createElement(
      "div",
    );

  footer.className =
    "nc-modal-footer";

  const cancel =
    actionButton(
      "Cancel",
    );

  const save =
    actionButton(
      "Save alert",
      "nc-button",
    );

  const test =
    actionButton(
      "Test alert",
      "nc-button secondary",
    );

  const yaml =
    actionButton(
      "YAML",
      "nc-button secondary",
    );

  test.disabled = !value.id;

  footer.append(
    cancel,
    test,
    yaml,
    save,
  );

  modal.append(
    header,
    body,
    footer,
  );

  backdrop.append(
    modal,
  );

  root.appendChild(
    backdrop,
  );

  // Basic

  const basicGrid =
    document.createElement(
      "div",
    );

  basicGrid.className =
    "nc-grid";

  const nameInput =
    input(
      "text",
      value.name,
      "Alert name",
    );

  const descriptionInput =
    textarea(
      value.description,
    );

  nameInput.addEventListener(
    "input",
    markDirty,
  );

  descriptionInput.addEventListener(
    "input",
    markDirty,
  );

  basicGrid.append(
    createField(
      "Name",
      nameInput,
    ),
    createField(
      "Description",
      descriptionInput,
      true,
    ),
  );

  body.append(
    sectionPanel(
      "Basic",
      basicGrid,
      true,
    ),
  );

  
  const checkGrid =
    document.createElement(
      "div",
    );

  checkGrid.className =
    "nc-grid";

  const onChange =
    checkbox(
      value.monitor?.on_change !== false,
    );

  const onChangeWrap =
    document.createElement(
      "div",
    );

  onChangeWrap.className =
    "nc-check";

  onChangeWrap.append(
    onChange,
    document.createTextNode(
      "When the condition changes",
    ),
  );

  const startup =
    checkbox(
      value.monitor?.startup !== false,
    );

  const startupWrap =
    document.createElement(
      "div",
    );

  startupWrap.className =
    "nc-check";

  startupWrap.append(
    startup,
    document.createTextNode(
      "Check when Home Assistant starts",
    ),
  );

  const intervalEnabled =
    Boolean(
      value.monitor?.interval,
    );

  const intervalToggle =
    checkbox(
      intervalEnabled,
    );

  const intervalInput =
    input(
      "time",
      value.monitor?.interval ||
        "12:00",
      "12:00",
    );

  intervalInput.step = "1";

  const intervalWrap =
    document.createElement(
      "div",
    );

  intervalWrap.className =
    "nc-check";

  intervalWrap.append(
    intervalToggle,
    document.createTextNode(
      "Check every",
    ),
  );

  const intervalField =
    document.createElement(
      "div",
    );

  intervalField.className =
    "nc-field";

  intervalField.append(
    intervalWrap,
    intervalInput,
  );

  const updateIntervalVisibility =
    () => {
      intervalInput.disabled =
        !intervalToggle.checked;
    };

  intervalToggle.addEventListener(
    "change",
    updateIntervalVisibility,
  );

  updateIntervalVisibility();

  checkGrid.append(
    createField(
      "When condition changes",
      onChangeWrap,
    ),
    intervalField,
    createField(
      "Check at startup",
      startupWrap,
    ),
  );

  const checkHelp =
    document.createElement(
      "div",
    );

  checkHelp.className =
    "nc-help";

  checkHelp.textContent =
    "You can select either method or both. " +
    "For example, use changes for immediate detection " +
    "and an interval as a safety check.";

  body.append(
    sectionPanel(
      "When to check",
      (() => {
        const wrap =
          document.createElement(
            "div",
          );
        wrap.append(
          checkGrid,
          checkHelp,
        );
        return wrap;
      })(),
      true,
    ),
  );

  
  const conditionInput =
    textarea(
      conditionFromAlert(value),
      true,
    );

  conditionInput.addEventListener(
    "input",
    markDirty,
  );

  const conditionMode =
    document.createElement(
      "div",
    );

  conditionMode.className =
    "nc-condition-mode";

  const visualButton = actionButton(
    "Visual conditions",
    "nc-condition-mode-button",
  );
  const jinjaButton = actionButton(
    "Advanced Jinja",
    "nc-condition-mode-button",
  );

  conditionMode.append(
    visualButton,
    jinjaButton,
  );

  const visualWrap =
    document.createElement(
      "div",
    );

  visualWrap.className =
    "nc-condition-visual";

  const getVisualConditions =
    visualConditionBuilder(
      visualWrap,
      registries,
      value.conditions,
      markDirty,
    );

  const jinjaWrap =
    document.createElement(
      "div",
    );

  jinjaWrap.append(
    createField(
      "Jinja condition",
      conditionInput,
      true,
    ),
  );

  const conditionHelp =
    document.createElement(
      "div",
    );

  conditionHelp.className =
    "nc-help";

  conditionHelp.textContent =
    "The condition should evaluate to true or false. " +
    "Home Assistant automatically tracks entities referenced by the template.";

  jinjaWrap.append(
    conditionHelp,
  );

  let conditionModeValue =
    value.conditions?.some(
      (condition) =>
        ["state", "numeric", "attribute"].includes(
          condition.type,
        ),
    )
      ? "visual"
      : "jinja";

  const updateConditionMode = () => {
    const visual =
      conditionModeValue === "visual";
    visualWrap.hidden = !visual;
    jinjaWrap.hidden = visual;
    visualButton.classList.toggle(
      "active",
      visual,
    );
    jinjaButton.classList.toggle(
      "active",
      !visual,
    );
  };

  visualButton.addEventListener(
    "click",
    () => {
      conditionModeValue = "visual";
      markDirty();
      updateConditionMode();
    },
  );
  jinjaButton.addEventListener(
    "click",
    () => {
      conditionModeValue = "jinja";
      markDirty();
      updateConditionMode();
    },
  );

  const conditionWrap =
    document.createElement(
      "div",
    );

  conditionWrap.append(
    conditionMode,
    visualWrap,
    jinjaWrap,
  );

  updateConditionMode();

  body.append(
    sectionPanel(
      "Condition",
      conditionWrap,
      true,
    ),
  );

  
  const target =
    targetFromAlert(
      value,
    );

  const notificationServiceForTarget =
    (selectedTarget) => {
      return Object.values(
        selectedTarget,
      ).some(
        (values) =>
          Array.isArray(values) &&
          values.length > 0,
      )
        ? "notify.send_message"
        : "";
    };

  const recipientPicker =
    createRecipientPicker(
      registries,
      target,
      markDirty,
    );

  const recipientWrap =
    document.createElement(
      "div",
    );

  recipientWrap.append(
    recipientPicker.element,
  );

  const recipientHelp =
    document.createElement(
      "div",
    );

  recipientHelp.className =
    "nc-help";

  recipientHelp.textContent =
    "Search for a recipient, choose a type when needed, then select it. You can mix devices, areas, labels, floors, and notification entities.";

  recipientWrap.append(
    recipientHelp,
  );

  const recipientSection =
    sectionPanel(
      "Recipients",
      recipientWrap,
      true,
    );

  recipientSection.classList.add(
    "nc-section-recipient",
  );

  body.append(
    recipientSection,
  );

  
  const notificationGrid =
    document.createElement(
      "div",
    );

  notificationGrid.className =
    "nc-grid";

  const titleInput =
    input(
      "text",
      value.notification?.title,
      "Reminder",
    );

  titleInput.addEventListener(
    "input",
    markDirty,
  );

  const messageInput =
    textarea(
      value.notification?.message,
    );

  messageInput.addEventListener(
    "input",
    markDirty,
  );

  notificationGrid.append(
    createField(
      "Title",
      titleInput,
    ),
    createField(
      "Message",
      messageInput,
      true,
    ),
  );

  const actionHelp =
    document.createElement(
      "div",
    );

  actionHelp.className =
    "nc-help";
  actionHelp.textContent =
    "Select notification entities in Recipients. They provide the notification service and can receive the confirmation action.";

  body.append(
    sectionPanel(
      "Notification",
      (() => {
        const wrap =
          document.createElement(
            "div",
          );
        wrap.append(
          notificationGrid,
          actionHelp,
        );
        return wrap;
      })(),
      true,
    ),
  );

  
  const repeatConfig =
    value.notification?.repeat;

  const repeatToggle =
    checkbox(
      Boolean(repeatConfig),
    );

  repeatToggle.addEventListener(
    "change",
    markDirty,
  );

  const repeatInterval =
    input(
      "time",
      repeatConfig?.interval ||
        "00:30",
      "00:30",
    );

  repeatInterval.step = "1";
  repeatInterval.addEventListener(
    "input",
    markDirty,
  );

  const repeatAttempts =
    input(
      "number",
      repeatConfig?.max_attempts ||
        5,
      "5",
    );

  repeatAttempts.addEventListener(
    "input",
    markDirty,
  );

  const repeatGrid =
    document.createElement(
      "div",
    );

  repeatGrid.className =
    "nc-grid";

  const repeatToggleWrap =
    document.createElement(
      "div",
    );

  repeatToggleWrap.className =
    "nc-check";

  repeatToggleWrap.append(
    repeatToggle,
    document.createTextNode(
      "Repeat while active",
    ),
  );

  repeatGrid.append(
    createField(
      "Repeat",
      repeatToggleWrap,
    ),
    createField(
      "Interval",
      repeatInterval,
    ),
    createField(
      "Maximum attempts",
      repeatAttempts,
    ),
  );

  body.append(
    sectionPanel(
      "Repeat notification",
      repeatGrid,
      false,
    ),
  );

  
  const confirmationConfig =
    value.notification?.confirmation ||
    {};

  const confirmationToggle =
    switchToggle(
      Boolean(confirmationConfig.enabled),
    );

  confirmationToggle.addEventListener(
    "change",
    markDirty,
  );

  const confirmationButton =
    input(
      "text",
      confirmationConfig.button ||
        "Activity completed",
    );

  confirmationButton.addEventListener(
    "input",
    markDirty,
  );

  const completionMessage =
    textarea(
      confirmationConfig.completion_message ||
        "",
    );

  completionMessage.addEventListener(
    "input",
    markDirty,
  );

  const resendInterval =
    input(
      "time",
      confirmationConfig.resend_interval ||
        "00:30:00",
      "00:30:00",
    );

  resendInterval.step = "1";
  resendInterval.addEventListener(
    "input",
    markDirty,
  );

  const confirmationAttempts =
    input(
      "number",
      confirmationConfig.max_attempts ||
        5,
      "5",
    );

  confirmationAttempts.min = "1";
  confirmationAttempts.max = "20";
  confirmationAttempts.addEventListener(
    "input",
    markDirty,
  );

  const actionsText =
    textarea(
      confirmationConfig.actions?.length
        ? JSON.stringify(
            confirmationConfig.actions,
            null,
            2,
          )
        : "[]",
      true,
    );

  actionsText.addEventListener(
    "input",
    markDirty,
  );

  const actionsToggle =
    switchToggle(
      Boolean(confirmationConfig.actions_enabled),
    );

  const actionsToggleWrap =
    document.createElement(
      "div",
    );

  actionsToggleWrap.className =
    "nc-check";
  actionsToggleWrap.append(
    actionsToggle,
    document.createTextNode(
      "Run actions after confirmation",
    ),
  );

  const updateActionsVisibility =
    () => {
      actionsText.disabled =
        !actionsToggle.checked;

      const actionsField =
        actionsText.closest(
          ".nc-field",
        );

      if (actionsField instanceof HTMLElement) {
        actionsField.hidden =
          !actionsToggle.checked;
      }
    };

  actionsToggle.addEventListener(
    "change",
    () => {
      markDirty();
      updateActionsVisibility();
    },
  );

  updateActionsVisibility();

  const confirmationGrid =
    document.createElement(
      "div",
    );

  confirmationGrid.className =
    "nc-grid";

  const confirmationToggleWrap =
    document.createElement(
      "div",
    );

  confirmationToggleWrap.className =
    "nc-check";

  confirmationToggleWrap.append(
    confirmationToggle,
    document.createTextNode(
      "Require confirmation",
    ),
  );

  confirmationGrid.append(
    createField(
      "Confirmation",
      confirmationToggleWrap,
    ),
    createField(
      "Button text",
      confirmationButton,
    ),
    createField(
      "Completion message",
      completionMessage,
      true,
    ),
    createField(
      "Reminder interval",
      resendInterval,
    ),
    createField(
      "Maximum reminders",
      confirmationAttempts,
    ),
    createField(
      "Follow-up actions",
      actionsToggleWrap,
      true,
    ),
    createField(
      "Actions after confirmation",
      actionsText,
      true,
    ),
  );

  updateActionsVisibility();

  const confirmationWrap =
    document.createElement(
      "div",
    );

  confirmationWrap.append(
    confirmationGrid,
  );

  const confirmationHelp =
    document.createElement(
      "div",
    );

  confirmationHelp.className =
    "nc-help";

  confirmationHelp.textContent =
    "Optional Home Assistant actions use JSON here, which is also valid YAML. Jinja templates are supported in action targets and data, just like conditions.";

  confirmationWrap.append(
    confirmationHelp,
  );

  body.append(
    sectionPanel(
      "Confirmation",
      confirmationWrap,
      Boolean(confirmationConfig.enabled),
    ),
  );

  const sectionHeader =
    document.createElement(
      "nav",
    );

  sectionHeader.className =
    "nc-section-header";
  sectionHeader.setAttribute(
    "aria-label",
    "Alert sections",
  );

  const sections = Array.from(
    body.querySelectorAll<HTMLElement>(".nc-section"),
  );

  const targetConfigured = Object.values(
    target,
  ).some(
    (values) =>
      Array.isArray(values) &&
      values.length > 0,
  );

  const sectionConfigured = [
    value.enabled !== false,
    Boolean(
      value.monitor?.on_change ||
      value.monitor?.interval,
    ),
    Boolean(
      conditionFromAlert(value).trim(),
    ),
    targetConfigured,
    Boolean(
      value.notification?.action ||
      value.notification?.message,
    ),
    Boolean(value.notification?.repeat),
    Boolean(
      value.notification?.confirmation?.enabled,
    ),
  ];

  let activeSection = 0;
  const sectionButtons = [];
  const sectionStatuses = [];

  const refreshSectionStatuses = () => {
    const configured = [
      Boolean(
        nameInput.value.trim() ||
        descriptionInput.value.trim(),
      ),
      Boolean(
        onChange.checked ||
        intervalToggle.checked ||
        startup.checked,
      ),
      conditionModeValue === "visual"
        ? getVisualConditions().length > 0
        : Boolean(conditionInput.value.trim()),
      Object.values(
        recipientPicker.target() as Record<string, string[]>,
      ).some(
        (values) => values.length > 0,
      ),
      Boolean(
        titleInput.value.trim() ||
        messageInput.value.trim(),
      ),
      repeatToggle.checked,
      confirmationToggle.checked,
    ];

    for (const [index, status] of sectionStatuses.entries()) {
      status.classList.toggle(
        "active",
        configured[index],
      );
      status.setAttribute(
        "aria-label",
        configured[index]
          ? "Configured"
          : "Not configured",
      );
    }
  };

  const showSection = (index) => {
    activeSection = index;

    for (const [sectionIndex, section] of sections.entries()) {
      section.classList.toggle(
        "active",
        sectionIndex === activeSection,
      );
    }

    for (const [buttonIndex, button] of sectionButtons.entries()) {
      const active =
        buttonIndex === activeSection;

      button.classList.toggle(
        "active",
        active,
      );

      if (active) {
        button.setAttribute(
          "aria-current",
          "step",
        );
      } else {
        button.removeAttribute(
          "aria-current",
        );
      }
    }
  };

  for (const [index, section] of sections.entries()) {
    const sectionButton =
      actionButton(
        "",
        "nc-section-nav-button",
      );

    const status =
      document.createElement(
        "span",
      );

    status.className =
      "nc-section-status";
    status.textContent = "●";
    status.classList.toggle(
      "active",
      sectionConfigured[index],
    );
    status.setAttribute(
      "aria-label",
      sectionConfigured[index]
        ? "Configured"
        : "Not configured",
    );

    const label =
      document.createElement(
        "span",
      );

    label.textContent =
      section.dataset.title;

    sectionButton.append(status, label);
    sectionStatuses.push(status);

    sectionButton.addEventListener(
      "click",
      () => {
          showSection(index);
      },
    );

      sectionButtons.push(sectionButton);
    sectionHeader.append(sectionButton);
  }

  body.prepend(sectionHeader);
    showSection(0);

  const statusControls = [
    nameInput,
    descriptionInput,
    onChange,
    intervalToggle,
    startup,
    conditionInput,
    titleInput,
    messageInput,
    repeatToggle,
    confirmationToggle,
    actionsToggle,
  ];

  for (const control of statusControls) {
    control.addEventListener(
      "input",
      refreshSectionStatuses,
    );
    control.addEventListener(
      "change",
      refreshSectionStatuses,
    );
  }

  recipientPicker.element.addEventListener(
    "change",
    refreshSectionStatuses,
  );

  refreshSectionStatuses();


  const closeEditor =
    () => {
      if (
        dirty &&
        !window.confirm(
          "Discard unsaved changes?",
        )
      ) {
        return;
      }

      backdrop.remove();

      if (page) {
        page.hidden = false;
      }
    };

  close.addEventListener(
    "click",
    () => {
      closeEditor();
      onCancel?.();
    },
  );

  cancel.addEventListener(
    "click",
    () => {
      closeEditor();
      onCancel?.();
    },
  );

  backdrop.addEventListener(
    "click",
    (event) => {
      if (
        event.target ===
        backdrop
      ) {
        closeEditor();
        onCancel?.();
      }
    },
  );

  test.addEventListener(
    "click",
    async () => {
      try {
        if (!value.id) {
          throw new Error(
            "Save the alert before testing it.",
          );
        }

        test.disabled = true;
        await onTest?.(value.id);
      } catch (err) {
        const toast =
          document.createElement(
            "div",
          );

        toast.className =
          "nc-toast";
        toast.textContent =
          errorMessage(err);
        toast.style.background =
          "var(--error-color)";
        toast.style.color = "white";
        root.append(toast);
        window.setTimeout(
          () => toast.remove(),
          6000,
        );
      } finally {
        test.disabled = !value.id;
      }
    },
  );

  yaml.addEventListener(
    "click",
    () => {
      showAlertYaml(root, value);
    },
  );

  save.addEventListener(
    "click",
    async () => {
      try {
        if (
          !nameInput.value.trim()
        ) {
          throw new Error(
            "Name is required.",
          );
        }

        if (
          !conditionInput.value.trim()
        ) {
          throw new Error(
            "Condition is required.",
          );
        }

        if (
          !onChange.checked &&
          !intervalToggle.checked
        ) {
          throw new Error(
            "Enable condition changes, an interval, or both.",
          );
        }

        const newTarget =
          recipientPicker.target();

        let actions = [];

        if (actionsToggle.checked) {
          try {
            actions =
              JSON.parse(
                actionsText.value ||
                  "[]",
              );
          } catch (_err) {
            throw new Error(
              "Actions after confirmation must contain valid JSON.",
            );
          }
        }

        const visualConditions =
          getVisualConditions();

        if (
          conditionModeValue === "visual" &&
          !visualConditions.length
        ) {
          throw new Error(
            "Add an entity to at least one condition.",
          );
        }

        const result =
          clone(value);

        const action =
          notificationServiceForTarget(
            newTarget,
          ) ||
          result.notification?.action ||
          "";

        const hasRecipient =
          Object.values(newTarget).some(
            (values) =>
              Array.isArray(values) &&
              values.length > 0,
          );

        if (!action && !hasRecipient) {
          throw new Error(
            "Select at least one device, area, label, or notification entity in Recipients.",
          );
        }

        result.name =
          nameInput.value.trim();

        result.description =
          descriptionInput.value;

        result.condition =
          conditionInput.value;

        result.conditions =
          conditionModeValue === "visual"
            ? visualConditions
            : [
                {
                  type: "template",
                  template:
                    conditionInput.value,
                },
              ];

        result.monitor = {
          on_change:
            onChange.checked,
          startup:
            startup.checked,
        };

        if (
          intervalToggle.checked
        ) {
          result.monitor.interval =
            intervalInput.value.trim();
        }

        const confirmation: Record<string, any> = {
          enabled: confirmationToggle.checked,
          button: confirmationButton.value.trim(),
          completion_message: completionMessage.value,
          resend_interval: resendInterval.value.trim(),
          max_attempts: Math.min(
            20,
            Math.max(1, Number(confirmationAttempts.value) || 5),
          ),
          actions_enabled: actionsToggle.checked,
        };

        if (actionsToggle.checked && actions.length) {
          confirmation.actions = actions;
        }

        result.notification = {
          action,
          target: newTarget,
          title: titleInput.value,
          message: messageInput.value,
          ...(result.notification?.data
            ? { data: result.notification.data }
            : {}),
          ...(repeatToggle.checked
            ? {
                repeat: {
                  interval: repeatInterval.value.trim(),
                  max_attempts: Number(repeatAttempts.value) || 5,
                },
              }
            : {}),
          confirmation,
        };

        delete result.condition;
        delete result.trigger;
        delete result.logic;
        delete result.notify_on_start;
        delete result.notifications;

        save.disabled =
          true;

        await onSave(
          result,
        );

        Object.assign(
          value,
          result,
        );
        dirty = false;
        save.disabled = false;

      } catch (err) {
        const toast =
          document.createElement(
            "div",
          );

        toast.className =
          "nc-toast";

        toast.textContent =
          errorMessage(err);
        toast.style.background =
          "var(--error-color)";
        toast.style.color = "white";
        root.append(toast);
        window.setTimeout(
          () => toast.remove(),
          6000,
        );

        save.disabled =
          false;
      }
    },
  );
}
