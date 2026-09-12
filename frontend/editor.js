function clone(value) {
  return JSON.parse(
    JSON.stringify(value),
  );
}

function createRecipientPicker(
  registries,
  target,
  markDirty,
) {
  const typeLabels = {
    device_id: "Devices",
    area_id: "Areas",
    floor_id: "Floors",
    label_id: "Labels",
    entity_id: "Notification entities",
  };

  const items = [
    ...(registries.devices || []).map(
      (item) => ({
        type: "device_id",
        id: item.id,
        label:
          item.name_by_user ||
          item.name ||
          item.id,
      }),
    ),
    ...(registries.areas || []).map(
      (item) => ({
        type: "area_id",
        id: item.area_id || item.id,
        label: item.name || item.id,
      }),
    ),
    ...(registries.floors || []).map(
      (item) => ({
        type: "floor_id",
        id: item.floor_id || item.id,
        label: item.name || item.id,
      }),
    ),
    ...(registries.labels || []).map(
      (item) => ({
        type: "label_id",
        id: item.label_id || item.id,
        label: item.name || item.id,
      }),
    ),
    ...(registries.entities || [])
      .filter(
        (item) =>
          item.entity_id?.startsWith(
            "notify.",
          ),
      )
      .map(
        (item) => ({
          type: "entity_id",
          id: item.entity_id,
          label:
            item.name || item.entity_id,
        }),
      ),
  ];

  const selected = new Set();

  for (const item of items) {
    if (
      (target[item.type] || []).some(
        (value) =>
          String(value) === String(item.id),
      )
    ) {
      selected.add(
        `${item.type}:${item.id}`,
      );
    }
  }

  const wrapper =
    document.createElement(
      "div",
    );

  wrapper.className =
    "nc-target-picker";

  const toolbar =
    document.createElement(
      "div",
    );

  toolbar.className =
    "nc-recipient-toolbar";

  const search =
    document.createElement(
      "input",
    );

  search.type = "search";
  search.placeholder =
    "Search devices, labels, or notification services";

  const filter =
    document.createElement(
      "div",
    );

  filter.className =
    "nc-recipient-filters";

  let selectedType = "all";

  const filterOptions = [
    ["all", "All"],
    ...Object.entries(typeLabels),
  ];

  for (const [value, label] of filterOptions) {
    const option =
      document.createElement(
        "button",
      );

    option.type = "button";
    option.className =
      "nc-recipient-filter";
    option.textContent = label;

    option.addEventListener(
      "click",
      () => {
        selectedType = value;
        isOpen = true;
        render();
      },
    );

    filter.appendChild(option);
  }

  const results =
    document.createElement(
      "div",
    );

  results.className =
    "nc-recipient-results";

  let isOpen = false;

  const selectedWrap =
    document.createElement(
      "div",
    );

  selectedWrap.className =
    "nc-target-chips";

  const selectedHeading =
    document.createElement(
      "div",
    );

  selectedHeading.className =
    "nc-target-selection-label";
  selectedHeading.textContent =
    "Selected recipients";

  const render = () => {
    selectedWrap.replaceChildren();

    for (const selectedKey of selected) {
      const [type, ...idParts] =
        selectedKey.split(":");
      const id = idParts.join(":");
      const item = items.find(
        (candidate) =>
          candidate.type === type &&
          String(candidate.id) === id,
      );

      const chip =
        document.createElement(
          "span",
        );

      chip.className =
        "nc-target-chip";

      chip.append(
        document.createTextNode(
          item?.label || id,
        ),
      );

      chip.title =
        typeLabels[type] || type;

      const remove =
        actionButton(
          "Remove",
          "nc-chip-remove",
        );

      remove.addEventListener(
        "click",
        () => {
          selected.delete(
            selectedKey,
          );
          markDirty();
          render();
        },
      );

      chip.append(remove);
      selectedWrap.append(chip);
    }

    const query =
      search.value.trim().toLowerCase();
    results.replaceChildren();
    results.hidden = !isOpen;

    for (const [index, option] of Array.from(
      filter.children,
    ).entries()) {
      option.classList.toggle(
        "active",
        filterOptions[index][0] === selectedType,
      );
    }

    const matchingItems = items.filter(
      (item) =>
        !selected.has(
          `${item.type}:${item.id}`,
        ) &&
        (selectedType === "all" ||
          item.type === selectedType) &&
        (!query ||
          item.label.toLowerCase().includes(query)),
    );

    if (!matchingItems.length) {
      const empty =
        document.createElement(
          "div",
        );

      empty.className =
        "nc-recipient-empty";
      empty.textContent = query
        ? "No matching recipients"
        : "No recipients available";
      results.append(empty);
    }

    for (const item of matchingItems) {
      const option =
        document.createElement(
          "button",
        );

      option.type = "button";
      option.className =
        "nc-recipient-option";
      option.textContent = item.label;
      option.title = typeLabels[item.type];

      option.addEventListener(
        "mousedown",
        (event) => event.preventDefault(),
      );

      option.addEventListener(
        "click",
        () => {
          selected.add(
            `${item.type}:${item.id}`,
          );
          markDirty();
          isOpen = false;
          render();
        },
      );

      results.append(option);
    }
  };

  search.addEventListener(
    "input",
    () => {
      isOpen = true;
      render();
    },
  );

  search.addEventListener(
    "focus",
    () => {
      isOpen = true;
      render();
    },
  );

  wrapper.addEventListener(
    "focusout",
    (event) => {
      if (
        !wrapper.contains(
          event.relatedTarget,
        )
      ) {
        isOpen = false;
        render();
      }
    },
  );

  const inputArea =
    document.createElement(
      "div",
    );

  inputArea.className =
    "nc-recipient-input";

  toolbar.append(
    search,
    filter,
  );

  inputArea.append(
    toolbar,
    results,
  );

  wrapper.append(
    selectedHeading,
    selectedWrap,
    inputArea,
  );
  render();

  return {
    element: wrapper,
    target: () => {
      const result = {};

      for (const selectedKey of selected) {
        const [type, ...idParts] =
          selectedKey.split(":");

        if (!result[type]) {
          result[type] = [];
        }

        result[type].push(
          idParts.join(":"),
        );
      }

      return result;
    },
  };
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

function conditionFromAlert(alert) {
  return (
    alert?.condition ||
    alert?.conditions?.find(
      (condition) =>
        condition.type === "template",
    )?.template ||
    "{{ false }}"
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

function visualConditionBuilder(
  container,
  registries,
  conditions,
  markDirty,
) {
  const supported = new Set([
    "state",
    "numeric",
    "attribute",
  ]);

  const state = (conditions || [])
    .filter(
      (condition) =>
        supported.has(condition.type),
    )
    .map(
      (condition) => ({
        ...condition,
      }),
    );

  if (!state.length) {
    state.push({
      type: "state",
      entity_id: "",
      state: "on",
    });
  }

  const entities = (
    registries.entities || []
  ).filter(
    (item) =>
      !item.entity_id?.startsWith(
        "notify.",
      ),
  );

  const rows =
    document.createElement(
      "div",
    );

  rows.className =
    "nc-condition-rows";

  const render = () => {
    rows.replaceChildren();

    state.forEach(
      (condition, index) => {
        const row =
          document.createElement(
            "div",
          );

        row.className =
          "nc-condition-row";

        const type =
          document.createElement(
            "select",
          );

        for (const [value, label] of [
          ["state", "State"],
          ["numeric", "Numeric state"],
          ["attribute", "Attribute"],
        ]) {
          const option =
            document.createElement(
              "option",
            );
          option.value = value;
          option.textContent = label;
          option.selected =
            condition.type === value;
          type.append(option);
        }

        const entity =
          document.createElement(
            "select",
          );

        const empty =
          document.createElement(
            "option",
          );
        empty.value = "";
        empty.textContent =
          "Choose an entity";
        entity.append(empty);

        for (const item of entities) {
          const option =
            document.createElement(
              "option",
            );
          option.value = item.entity_id;
          option.textContent =
            item.name || item.entity_id;
          option.selected =
            condition.entity_id ===
            item.entity_id;
          entity.append(option);
        }

        const stateInput = input(
          "text",
          condition.state || "",
          "on",
        );
        const aboveInput = input(
          "number",
          condition.above ?? "",
          "Above",
        );
        const belowInput = input(
          "number",
          condition.below ?? "",
          "Below",
        );
        const attributeInput = input(
          "text",
          condition.attribute || "",
          "Attribute name",
        );
        const valueInput = input(
          "text",
          condition.value ?? "",
          "Expected value",
        );
        const forInput = input(
          "time",
          condition.for || "",
          "For",
        );
        forInput.step = "1";

        const fields = [
          createField("Type", type),
          createField("Entity", entity),
          createField("State", stateInput),
          createField("Above", aboveInput),
          createField("Below", belowInput),
          createField("Attribute", attributeInput),
          createField("Expected value", valueInput),
          createField("For", forInput),
        ];

        const updateVisibility = () => {
          const selected = type.value;
          fields[2].hidden = selected !== "state";
          fields[3].hidden = selected !== "numeric";
          fields[4].hidden = selected !== "numeric";
          fields[5].hidden = selected !== "attribute";
          fields[6].hidden = selected !== "attribute";
        };

        type.addEventListener("change", () => {
          condition.type = type.value;
          markDirty();
          updateVisibility();
        });
        entity.addEventListener("change", () => {
          condition.entity_id = entity.value;
          markDirty();
        });

        for (const [control, key] of [
          [stateInput, "state"],
          [aboveInput, "above"],
          [belowInput, "below"],
          [attributeInput, "attribute"],
          [valueInput, "value"],
          [forInput, "for"],
        ]) {
          control.addEventListener("input", () => {
            condition[key] = control.value;
            markDirty();
          });
        }

        const remove = actionButton(
          "Remove condition",
          "nc-button danger",
        );
        remove.disabled = state.length === 1;
        remove.addEventListener("click", () => {
          state.splice(index, 1);
          markDirty();
          render();
        });

        row.append(
          ...fields,
          remove,
        );
        rows.append(row);
        updateVisibility();
      },
    );
  };

  const add = actionButton(
    "Add condition",
    "nc-button secondary",
  );
  add.addEventListener("click", () => {
    state.push({
      type: "state",
      entity_id: "",
      state: "on",
    });
    markDirty();
    render();
  });

  container.append(rows, add);
  render();

  return () => state.filter(
    (condition) => condition.entity_id,
  );
}

function sectionPanel(
  _title,
  content,
  _open = true,
  _active = false,
) {
  const wrapper =
    document.createElement(
      "section",
    );

  wrapper.className =
    "nc-section";
  wrapper.dataset.title = _title;

  content.classList.add(
    "nc-section-content",
  );

  wrapper.append(
    content,
  );

  return wrapper;
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

  value.notification = {
    ...(value.notifications?.[0] || {}),
    ...(value.notification || {}),
  };

  value.notification.confirmation = {
    ...(value.confirmation || {}),
    ...(value.notification.confirmation || {}),
  };

  const backdrop =
    document.createElement(
      "div",
    );

  backdrop.className =
    "nc-editor-view";

  const page = root.querySelector(
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

  // ---------------------------------------------------------
  // Check
  // ---------------------------------------------------------

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
      "Event trigger",
      onChangeWrap,
    ),
    intervalField,
    createField(
      "Startup",
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
      "Check",
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

  // ---------------------------------------------------------
  // Condition
  // ---------------------------------------------------------

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

  // ---------------------------------------------------------
  // Recipients
  // ---------------------------------------------------------

  const target =
    targetFromAlert(
      value,
    );

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
    "Search for a recipient, choose a type when needed, then select it. You can mix devices, areas, labels, floors, and notification services.";

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

  // ---------------------------------------------------------
  // Notification
  // ---------------------------------------------------------

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

  const actionInput =
    input(
      "text",
      value.notification?.action ||
        "notify.send_message",
      "notify.send_message",
    );

  actionInput.addEventListener(
    "input",
    markDirty,
  );

  notificationGrid.append(
    createField(
      "Notification service",
      actionInput,
    ),
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

  body.append(
    sectionPanel(
      "Notification",
      notificationGrid,
      true,
    ),
  );

  // ---------------------------------------------------------
  // Repeat
  // ---------------------------------------------------------

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

  // ---------------------------------------------------------
  // Confirmation
  // ---------------------------------------------------------

  const confirmationConfig =
    value.notification?.confirmation ||
    {};

  const confirmationToggle =
    checkbox(
      confirmationConfig.enabled,
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
      "Actions after confirmation",
      actionsText,
      true,
    ),
  );

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
    "Advanced actions use JSON here. JSON is also valid YAML, so the same structure can be copied into the YAML editor.";

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

  const sectionNav =
    document.createElement(
      "nav",
    );

  sectionNav.className =
    "nc-section-nav";
  sectionNav.setAttribute(
    "aria-label",
    "Alert sections",
  );

  const sections = [
    ...body.querySelectorAll(
    ".nc-section",
    ),
  ];

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

  const showSection = (index) => {
    activeSection = index;

    for (const [sectionIndex, section] of sections.entries()) {
      section.hidden =
        sectionIndex !== activeSection;
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

    sectionButton.addEventListener(
      "click",
      () => {
          showSection(index);
      },
    );

      sectionButtons.push(sectionButton);
    sectionNav.append(sectionButton);
  }

  body.prepend(sectionNav);
    showSection(0);

  // ---------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------

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
        Object.assign(
          newTarget,
          recipientPicker.target(),
        );

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

        result.notify_on_start =
          startup.checked;

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
            actionInput.value.trim() ||
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
            resend_interval:
              resendInterval.value.trim(),
            max_attempts:
              Math.min(
                20,
                Math.max(
                  1,
                  Number(
                    confirmationAttempts.value,
                  ) || 5,
                ),
              ),
            actions,
          },
        };

        result.confirmation =
          clone(
            result.notification.confirmation,
          );

        save.disabled =
          true;

        dirty = false;

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