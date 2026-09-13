export type Hass = any;

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

export function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]`;
    return value.map((item) => {
      if (item && typeof item === "object") {
        const nested = toYaml(item, indent + 2).trimStart();
        return `${pad}- ${nested}`;
      }
      return `${pad}- ${yamlScalar(item)}`;
    }).join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return `${pad}{}`;
    return entries.map(([key, item]) => {
      if (item && typeof item === "object") {
        return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
      }
      return `${pad}${key}: ${yamlScalar(item)}`;
    }).join("\n");
  }

  return `${pad}${yamlScalar(value)}`;
}

export function createYamlEditor(
  value: string,
  readOnly = false,
): HTMLTextAreaElement | HTMLElement & { value: string } {
  const editor = document.createElement("ha-code-editor") as HTMLElement & {
    value: string;
  };

  editor.setAttribute("mode", "yaml");
  if (readOnly) editor.setAttribute("read-only", "");
  editor.value = value;
  editor.classList.add("nc-code-editor");

  return editor;
}

export function defaultAlert() {
  return {
    id: `alert_${Date.now()}`,
    name: "New alert",
    enabled: true,
    description: "",
    icon: "mdi:bell-outline",
    conditions: [
      {
        type: "template",
        template: "{{ false }}",
      },
    ],
    monitor: {
      on_change: true,
      startup: true,
    },
    notification: {
      action: "notify.send_message",
      target: {},
      title: "Reminder",
      message: "Something needs your attention.",
      confirmation: {
        enabled: false,
        button: "Activity completed",
        completion_message: "",
        resend_interval: "00:30:00",
        max_attempts: 5,
        actions_enabled: false,
      },
    },
  };
}
export function targetFromAlert(alert) {
  return (
    alert?.notification?.target ||
    {}
  );
}

export function conditionFromAlert(alert) {
  return (
    alert?.condition ||
    alert?.conditions?.find(
      (condition) =>
        condition.type === "template",
    )?.template ||
    "{{ false }}"
  );
}

export function createField(
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

export function input(
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

export function textarea(
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

export function switchToggle(
  checked: boolean,
): HTMLInputElement {
  const element = checkbox(checked);
  element.classList.add("nc-switch-input");
  return element;
}

export function checkbox(
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

export function actionButton(
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

export function sectionPanel(
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

