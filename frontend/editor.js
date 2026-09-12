function clone(value) {
  return JSON.parse(
    JSON.stringify(value),
  );
}

function selectedValues(select) {
  return Array.from(
    select.selectedOptions,
  ).map(
    (option) => option.value,
  );
}

function fillSelect(
  select,
  items,
  selected,
  labelGetter,
  valueGetter,
) {
  select.replaceChildren();

  const selectedSet = new Set(
    selected || [],
  );

  for (const item of items) {
    const option =
      document.createElement(
        "option",
      );

    option.value =
      valueGetter(item);

    option.textContent =
      labelGetter(item);

    option.selected =
      selectedSet.has(
        option.value,
      );

    select.appendChild(
      option,
    );
  }
}

function defaultAlert() {
  return {
    id: `alert_${Date.now()}`,
    name: "New alert",
    enabled: true,
    description: "",
    icon: "mdi:bell-outline",
    condition:
      "{{ false }}",
    monitor: {
      on_change: true,
    },
    notification: {
      action:
        "notify.send_message",
      target: {},
      title: "Reminder",
      message:
        "Something needs your attention.",
      data: {},
      repeat: null,
      confirmation: {
        enabled: false,
        button:
          "Activity completed",
        completion_message: "",
        actions: [],
      },
    },
  };
}

function targetFromAlert(alert) {
  return (
    alert?.notification?.target ||
    {}
  );
}

function createField(
  label,
  control,
  full = false,
) {
  const wrapper =
    document.createElement(
      "div",
    );

  wrapper.className =
    `nc-field${full ? " full" : ""}`;

  const labelElement =
    document.createElement(
      "label",
    );

  labelElement.textContent =
    label;

  wrapper.append(
    labelElement,
    control,
  );

  return wrapper;
}

function input(
  type,
  value,
  placeholder = "",
) {
  const element =
    document.createElement(
      "input",
    );

  element.type = type;
  element.value =
    value ?? "";
  element.placeholder =
    placeholder;

  return element;
}

function textarea(
  value,
  code = false,
) {
  const element =
    document.createElement(
      "textarea",
    );

  element.value =
    value ?? "";

  if (code) {
    element.classList.add(
      "code",
    );
  }

  return element;
}

function checkbox(
  checked,
) {
  const element =
    document.createElement(
      "input",
    );

  element.type = "checkbox";
  element.checked =
    Boolean(checked);

  return element;
}

function actionButton(
  text,
  className = "nc-button secondary",
) {
  const button =
    document.createElement(
      "button",
    );

  button.type = "button";
  button.className =
    className;
  button.textContent =
    text;

  return button;
}

export function openEditor({
  root,
  alert,
  registries,
  onSave,
  onCancel,
}) {
  const value = clone(
    alert || defaultAlert(),
  );

  const backdrop =
    document.createElement(
      "div",
    );

  backdrop.className =
    "nc-modal-backdrop";

  const modal =
    document.createElement(
      "div",
    );

  modal.className =
    "nc-modal";

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
      "Close",
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

  footer.append(
    cancel,
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

  // ---------------------------------------------------------
  // Basic
  // ---------------------------------------------------------

  const basic =
    document.createElement(
      "section",
    );

  basic.className =
    "nc-section";

  basic.innerHTML =
    "<h3>Basic</h3>";

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

  const enabledInput =
    checkbox(
      value.enabled !== false,
    );

  const enabledWrap =
    document.createElement(
      "div",
    );

  enabledWrap.className =
    "nc-check";

  enabledWrap.append(
    enabledInput,
    document.createTextNode(
      "Enabled",
    ),
  );

  const descriptionInput =
    textarea(
      value.description,
    );

  basicGrid.append(
    createField(
      "Name",
      nameInput,
    ),
    createField(
      "Status",
      enabledWrap,
    ),
    createField(
      "Description",
      descriptionInput,
      true,
    ),
  );

  basic.append(
    basicGrid,
  );

  body.append(
    basic,
  );

  // ---------------------------------------------------------
  // Check
  // ---------------------------------------------------------

  const check =
    document.createElement(
      "section",
    );

  check.className =
    "nc-section";

  check.innerHTML =
    "<h3>Check</h3>";

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
      "text",
      value.monitor?.interval ||
        "12:00:00",
      "12:00:00",
    );

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
      "Event trigger",
      onChangeWrap,
    ),
    intervalField,
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

  check.append(
    checkGrid,
    checkHelp,
  );

  body.append(
    check,
  );

  // ---------------------------------------------------------
  // Condition
  // ---------------------------------------------------------

  const condition =
    document.createElement(
      "section",
    );

  condition.className =
    "nc-section";

  condition.innerHTML =
    "<h3>Condition</h3>";

  const conditionInput =
    textarea(
      value.condition,
      true,
    );

  condition.append(
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

  condition.append(
    conditionHelp,
  );

  body.append(
    condition,
  );

  // ---------------------------------------------------------
  // Recipients
  // ---------------------------------------------------------

  const recipients =
    document.createElement(
      "section",
    );

  recipients.className =
    "nc-section";

  recipients.innerHTML =
    "<h3>Recipients</h3>";

  const target =
    targetFromAlert(
      value,
    );

  const recipientGrid =
    document.createElement(
      "div",
    );

  recipientGrid.className =
    "nc-grid";

  const deviceSelect =
    document.createElement(
      "select",
    );

  deviceSelect.multiple = true;
  deviceSelect.className =
    "nc-target-select";

  fillSelect(
    deviceSelect,
    registries.devices || [],
    target.device_id,
    (item) =>
      item.name_by_user ||
      item.name ||
      item.id,
    (item) =>
      item.id,
  );

  const areaSelect =
    document.createElement(
      "select",
    );

  areaSelect.multiple = true;
  areaSelect.className =
    "nc-target-select";

  fillSelect(
    areaSelect,
    registries.areas || [],
    target.area_id,
    (item) =>
      item.name || item.id,
    (item) =>
      item.area_id || item.id,
  );

  const labelSelect =
    document.createElement(
      "select",
    );

  labelSelect.multiple = true;
  labelSelect.className =
    "nc-target-select";

  fillSelect(
    labelSelect,
    registries.labels || [],
    target.label_id,
    (item) =>
      item.name || item.label_id,
    (item) =>
      item.label_id || item.id,
  );

  const notifyEntities =
    (registries.entities || [])
      .filter(
        (item) =>
          item.entity_id?.startsWith(
            "notify.",
          ),
      );

  const entitySelect =
    document.createElement(
      "select",
    );

  entitySelect.multiple = true;
  entitySelect.className =
    "nc-target-select";

  fillSelect(
    entitySelect,
    notifyEntities,
    target.entity_id,
    (item) =>
      item.name ||
      item.entity_id,
    (item) =>
      item.entity_id,
  );

  recipientGrid.append(
    createField(
      "Devices",
      deviceSelect,
    ),
    createField(
      "Areas",
      areaSelect,
    ),
    createField(
      "Labels",
      labelSelect,
    ),
    createField(
      "Notification entities",
      entitySelect,
    ),
  );

  recipients.append(
    recipientGrid,
  );

  const recipientHelp =
    document.createElement(
      "div",
    );

  recipientHelp.className =
    "nc-help";

  recipientHelp.textContent =
    "Targets can be mixed. A label, area, device and specific notification entity can all be selected together.";

  recipients.append(
    recipientHelp,
  );

  body.append(
    recipients,
  );

  // ---------------------------------------------------------
  // Notification
  // ---------------------------------------------------------

  const notification =
    document.createElement(
      "section",
    );

  notification.className =
    "nc-section";

  notification.innerHTML =
    "<h3>Notification</h3>";

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

  const messageInput =
    textarea(
      value.notification?.message,
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

  notification.append(
    notificationGrid,
  );

  body.append(
    notification,
  );

  // ---------------------------------------------------------
  // Repeat
  // ---------------------------------------------------------

  const repeat =
    document.createElement(
      "section",
    );

  repeat.className =
    "nc-section";

  repeat.innerHTML =
    "<h3>Repeat notification</h3>";

  const repeatConfig =
    value.notification?.repeat;

  const repeatToggle =
    checkbox(
      Boolean(repeatConfig),
    );

  const repeatInterval =
    input(
      "text",
      repeatConfig?.interval ||
        "00:30:00",
      "00:30:00",
    );

  const repeatAttempts =
    input(
      "number",
      repeatConfig?.max_attempts ||
        5,
      "5",
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

  repeat.append(
    repeatGrid,
  );

  body.append(
    repeat,
  );

  // ---------------------------------------------------------
  // Confirmation
  // ---------------------------------------------------------

  const confirmation =
    document.createElement(
      "section",
    );

  confirmation.className =
    "nc-section";

  confirmation.innerHTML =
    "<h3>Confirmation</h3>";

  const confirmationConfig =
    value.notification?.confirmation ||
    {};

  const confirmationToggle =
    checkbox(
      confirmationConfig.enabled,
    );

  const confirmationButton =
    input(
      "text",
      confirmationConfig.button ||
        "Activity completed",
    );

  const completionMessage =
    textarea(
      confirmationConfig.completion_message ||
        "",
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
      "Actions after confirmation",
      actionsText,
      true,
    ),
  );

  confirmation.append(
    confirmationGrid,
  );

  const confirmationHelp =
    document.createElement(
      "div",
    );

  confirmationHelp.className =
    "nc-help";

  confirmationHelp.textContent =
    "Advanced actions use JSON here. JSON is also valid YAML, so the same structure can be copied into the YAML editor.";

  confirmation.append(
    confirmationHelp,
  );

  body.append(
    confirmation,
  );

  // ---------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------

  const closeEditor =
    () => {
      backdrop.remove();
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

        const newTarget = {};

        const devices =
          selectedValues(
            deviceSelect,
          );

        const areas =
          selectedValues(
            areaSelect,
          );

        const labels =
          selectedValues(
            labelSelect,
          );

        const entities =
          selectedValues(
            entitySelect,
          );

        if (devices.length) {
          newTarget.device_id =
            devices;
        }

        if (areas.length) {
          newTarget.area_id =
            areas;
        }

        if (labels.length) {
          newTarget.label_id =
            labels;
        }

        if (entities.length) {
          newTarget.entity_id =
            entities;
        }

        if (
          !Object.keys(
            newTarget,
          ).length
        ) {
          throw new Error(
            "Select at least one notification target.",
          );
        }

        let actions = [];

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

        const result =
          clone(value);

        result.name =
          nameInput.value.trim();

        result.enabled =
          enabledInput.checked;

        result.description =
          descriptionInput.value;

        result.condition =
          conditionInput.value;

        result.monitor = {
          on_change:
            onChange.checked,
        };

        if (
          intervalToggle.checked
        ) {
          result.monitor.interval =
            intervalInput.value.trim();
        }

        result.notification = {
          ...(result.notification ||
            {}),
          action:
            "notify.send_message",
          target:
            newTarget,
          title:
            titleInput.value,
          message:
            messageInput.value,
          data:
            result.notification?.data ||
            {},
          repeat:
            repeatToggle.checked
              ? {
                  interval:
                    repeatInterval.value.trim(),
                  max_attempts:
                    Number(
                      repeatAttempts.value,
                    ) || 5,
                }
              : null,
          confirmation: {
            enabled:
              confirmationToggle.checked,
            button:
              confirmationButton.value,
            completion_message:
              completionMessage.value,
            actions,
          },
        };

        save.disabled =
          true;

        await onSave(
          result,
        );

        closeEditor();

      } catch (err) {
        const error =
          document.createElement(
            "div",
          );

        error.className =
          "nc-error";

        error.textContent =
          err?.message ||
          String(err);

        const old =
          body.querySelector(
            ".nc-error",
          );

        old?.remove();

        body.prepend(
          error,
        );

        save.disabled =
          false;
      }
    },
  );
}