import { errorMessage } from "./api.js";
import { buildAlertPayload } from "./alert-payload.js";
import { visualConditionBuilder } from "./condition-builder.js";
import { createRecipientPicker } from "./recipient-picker.js";
import { html, render } from "lit";
import type { TemplateResult } from "lit";
import type { Alert, Registries } from "./types.js";

type FormControl = HTMLInputElement | HTMLTextAreaElement;
type CodeEditor = HTMLElement & { value: string };
type EditorMode = "visual" | "jinja";

interface EditorContext {
  value: Alert;
  mode: EditorMode;
  markDirty(): void;
  refreshStatuses(): void;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function defaultAlert(): Alert {
  return {
    id: `alert_${Date.now()}`,
    name: "New alert",
    enabled: true,
    description: "",
    icon: "mdi:bell-outline",
    conditions: [{ type: "template", template: "{{ false }}" }],
    monitor: { on_change: true, startup: true },
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

function conditionTemplate(alert: Alert): string {
  return (
    alert.conditions.find((condition) => condition.type === "template")
      ?.template || "{{ false }}"
  );
}

function valueOf(event: Event): string {
  return (event.currentTarget as FormControl).value;
}

function checkedOf(event: Event): boolean {
  return (event.currentTarget as HTMLInputElement).checked;
}

function field(
  label: string,
  content: TemplateResult,
  full = false,
): TemplateResult {
  return html`<div class=${full ? "nc-field full" : "nc-field"}>
    <label>${label}</label>${content}
  </div>`;
}

function section(
  title: string,
  content: TemplateResult,
  className = "",
): TemplateResult {
  return html`<section class="nc-section ${className}" data-title=${title}>
    <div class="nc-section-content">${content}</div>
  </section>`;
}

function renderBasicSection(context: EditorContext): TemplateResult {
  const { value } = context;
  return section(
    "Basic",
    html`<div class="nc-grid">
      ${field(
        "Name",
        html`<input
          type="text"
          .value=${value.name}
          placeholder="Alert name"
          @input=${(event: Event) => {
            value.name = valueOf(event);
            context.markDirty();
            context.refreshStatuses();
          }}
        />`,
      )}
      ${field(
        "Description",
        html`<textarea
          .value=${value.description}
          @input=${(event: Event) => {
            value.description = valueOf(event);
            context.markDirty();
            context.refreshStatuses();
          }}
        ></textarea>`,
        true,
      )}
    </div>`,
  );
}

function renderMonitorSection(context: EditorContext): TemplateResult {
  const monitor = context.value.monitor;
  return section(
    "When to check",
    html`<div class="nc-grid">
        ${field(
          "When condition changes",
          html`<div class="nc-check">
            <input
              type="checkbox"
              .checked=${monitor.on_change !== false}
              @change=${(event: Event) => {
                monitor.on_change = checkedOf(event);
                context.markDirty();
                context.refreshStatuses();
              }}
            /><span>When the condition changes</span>
          </div>`,
        )}
        ${field(
          "Check every",
          html`<div class="nc-check">
              <input
                data-role="interval-toggle"
                type="checkbox"
                .checked=${Boolean(monitor.interval)}
                @change=${(event: Event) => {
                  monitor.interval = checkedOf(event)
                    ? monitor.interval || "12:00"
                    : undefined;
                  context.markDirty();
                  context.refreshStatuses();
                }}
              /><span>Check every</span>
            </div>
            <input
              data-role="interval"
              type="time"
              step="1"
              .value=${monitor.interval || "12:00"}
              @input=${(event: Event) => {
                monitor.interval = valueOf(event);
                context.markDirty();
              }}
            />`,
        )}
        ${field(
          "Check at startup",
          html`<div class="nc-check">
            <input
              type="checkbox"
              .checked=${monitor.startup !== false}
              @change=${(event: Event) => {
                monitor.startup = checkedOf(event);
                context.markDirty();
                context.refreshStatuses();
              }}
            /><span>Check when Home Assistant starts</span>
          </div>`,
        )}
      </div>
      <div class="nc-help">
        You can select either method or both. For example, use changes for
        immediate detection and an interval as a safety check.
      </div>`,
  );
}

function renderConditionSection(context: EditorContext): TemplateResult {
  const condition = conditionTemplate(context.value);
  return section(
    "Condition",
    html`<div class="nc-condition-mode">
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => setMode(context, "visual")}
        >
          Visual conditions
        </button>
        <button
          class="nc-button secondary nc-condition-mode-button"
          @click=${() => setMode(context, "jinja")}
        >
          Advanced Jinja
        </button>
      </div>
      <div data-role="visual" class="nc-condition-visual"></div>
      <div data-role="jinja">
        ${field(
          "Jinja condition",
          html`<textarea
            data-role="condition"
            .value=${condition}
            @input=${(event: Event) => {
              context.value.conditions = [
                { type: "template", template: valueOf(event) },
              ];
              context.markDirty();
              context.refreshStatuses();
            }}
          ></textarea>`,
          true,
        )}
        <div class="nc-help">
          The condition should evaluate to true or false. Home Assistant
          automatically tracks entities referenced by the template.
        </div>
      </div>`,
  );
}

function renderRecipientSection(): TemplateResult {
  return section(
    "Recipients",
    html`<div data-role="recipients"></div>
      <div class="nc-help">
        Search for a recipient, choose a type when needed, then select it. You
        can mix devices, areas, labels, floors, and notification entities.
      </div>`,
    "nc-section-recipient",
  );
}

function renderNotificationSection(context: EditorContext): TemplateResult {
  const notification = context.value.notification;
  return section(
    "Notification",
    html`<div class="nc-grid">
        ${field(
          "Title",
          html`<input
            type="text"
            .value=${notification.title || "Reminder"}
            @input=${(event: Event) => {
              notification.title = valueOf(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          />`,
        )}
        ${field(
          "Message",
          html`<textarea
            .value=${notification.message || ""}
            @input=${(event: Event) => {
              notification.message = valueOf(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          ></textarea>`,
          true,
        )}
      </div>
      <div class="nc-help">
        Select notification entities in Recipients. They provide the
        notification service and can receive the confirmation action.
      </div>`,
  );
}

function renderRepeatSection(context: EditorContext): TemplateResult {
  const repeat = context.value.notification.repeat;
  return section(
    "Repeat notification",
    html`<div class="nc-grid">
      ${field(
        "Repeat",
        html`<div class="nc-check">
          <input
            data-role="repeat"
            type="checkbox"
            .checked=${Boolean(repeat)}
            @change=${(event: Event) => {
              if (checkedOf(event))
                context.value.notification.repeat ||= {
                  interval: "00:30",
                  max_attempts: 5,
                };
              else delete context.value.notification.repeat;
              context.markDirty();
              context.refreshStatuses();
            }}
          /><span>Repeat while active</span>
        </div>`,
      )}
      ${field(
        "Interval",
        html`<input
          type="time"
          step="1"
          .value=${repeat?.interval || "00:30"}
          @input=${(event: Event) => {
            if (context.value.notification.repeat)
              context.value.notification.repeat.interval = valueOf(event);
            context.markDirty();
          }}
        />`,
      )}
      ${field(
        "Maximum attempts",
        html`<input
          type="number"
          .value=${String(repeat?.max_attempts || 5)}
          @input=${(event: Event) => {
            if (context.value.notification.repeat)
              context.value.notification.repeat.max_attempts =
                Number(valueOf(event)) || 5;
            context.markDirty();
          }}
        />`,
      )}
    </div>`,
  );
}

function renderConfirmationSection(context: EditorContext): TemplateResult {
  const confirmation = context.value.notification.confirmation;
  return section(
    "Confirmation",
    html`<div class="nc-grid">
        ${field(
          "Confirmation",
          html`<div class="nc-check">
            <input
              type="checkbox"
              .checked=${Boolean(confirmation.enabled)}
              @change=${(event: Event) => {
                confirmation.enabled = checkedOf(event);
                context.markDirty();
                context.refreshStatuses();
              }}
            /><span>Require confirmation</span>
          </div>`,
        )}
        ${field(
          "Button text",
          html`<input
            type="text"
            .value=${confirmation.button || "Activity completed"}
            @input=${(event: Event) => {
              confirmation.button = valueOf(event);
              context.markDirty();
            }}
          />`,
        )}
        ${field(
          "Completion message",
          html`<textarea
            .value=${confirmation.completion_message || ""}
            @input=${(event: Event) => {
              confirmation.completion_message = valueOf(event);
              context.markDirty();
            }}
          ></textarea>`,
          true,
        )}
        ${field(
          "Reminder interval",
          html`<input
            type="time"
            step="1"
            .value=${String(confirmation.resend_interval || "00:30:00")}
            @input=${(event: Event) => {
              confirmation.resend_interval = valueOf(event);
              context.markDirty();
            }}
          />`,
        )}
        ${field(
          "Maximum reminders",
          html`<input
            type="number"
            min="1"
            max="20"
            .value=${String(confirmation.max_attempts || 5)}
            @input=${(event: Event) => {
              confirmation.max_attempts = Math.min(
                20,
                Math.max(1, Number(valueOf(event)) || 5),
              );
              context.markDirty();
            }}
          />`,
        )}
        ${field(
          "Follow-up actions",
          html`<div class="nc-check">
            <input
              data-role="actions-toggle"
              type="checkbox"
              .checked=${Boolean(confirmation.actions_enabled)}
              @change=${(event: Event) => {
                confirmation.actions_enabled = checkedOf(event);
                context.markDirty();
              }}
            /><span>Run actions after confirmation</span>
          </div>`,
          true,
        )}
        ${field(
          "Actions after confirmation",
          html`<textarea
            data-role="actions"
            class="code"
            .value=${JSON.stringify(confirmation.actions || [], null, 2)}
            @input=${() => context.markDirty()}
          ></textarea>`,
          true,
        )}
      </div>
      <div class="nc-help">
        Optional Home Assistant actions use JSON here, which is also valid YAML.
        Jinja templates are supported in action targets and data, just like
        conditions.
      </div>`,
  );
}

function setMode(context: EditorContext, mode: EditorMode): void {
  context.mode = mode;
  context.markDirty();
  context.refreshStatuses();
}

function showYaml(root: ShadowRoot, alert: Alert): void {
  const host = document.createElement("div");
  const close = () => host.remove();
  render(
    html`<div
      class="nc-modal-backdrop"
      @click=${(event: MouseEvent) =>
        event.target === event.currentTarget && close()}
    >
      <section class="nc-modal nc-alert-yaml-modal">
        <header class="nc-modal-header">
          <h2>Alert YAML</h2>
          <button class="nc-button secondary" @click=${close}>
            Back to editor
          </button>
        </header>
        <main class="nc-modal-body">
          <div class="nc-help">
            This is a read-only view of the alert currently being edited.
          </div>
          <ha-code-editor
            mode="yaml"
            language="yaml"
            read-only
            class="nc-code-editor nc-alert-yaml-editor"
          ></ha-code-editor>
        </main>
      </section>
    </div>`,
    host,
  );
  const editor = host.querySelector<CodeEditor>("ha-code-editor");
  if (!editor) throw new Error("Missing alert YAML editor");
  editor.value = yamlValue(alert);
  root.append(host);
}

function yamlValue(value: unknown, indent = 0): string {
  const padding = " ".repeat(indent);
  if (Array.isArray(value))
    return value.length
      ? value
          .map(
            (item) => `${padding}- ${yamlValue(item, indent + 2).trimStart()}`,
          )
          .join("\n")
      : `${padding}[]`;
  if (value && typeof value === "object")
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${padding}${key}: ${yamlValue(item, indent + 2)}`)
      .join("\n");
  return typeof value === "string"
    ? JSON.stringify(value)
    : String(value ?? "null");
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
  alert?: Alert;
  registries: Registries;
  onSave: (alert: Alert) => Promise<void>;
  onTest: (alertId: string) => Promise<void>;
  onCancel?: () => void;
}): void {
  const value = clone(alert || defaultAlert());
  value.notification.confirmation = {
    enabled: false,
    button: "",
    completion_message: "",
    resend_interval: "00:30:00",
    max_attempts: 5,
    actions_enabled: false,
    ...value.notification.confirmation,
  };
  const host = document.createElement("div");
  const page = root.querySelector<HTMLElement>(".nc-page");
  if (page) page.hidden = true;
  let dirty = false;
  const context: EditorContext = {
    value,
    mode: value.conditions.some((item) =>
      ["state", "numeric", "attribute"].includes(item.type),
    )
      ? "visual"
      : "jinja",
    markDirty: () => {
      dirty = true;
    },
    refreshStatuses: () => {},
  };
  const titles = [
    "Basic",
    "When to check",
    "Condition",
    "Recipients",
    "Notification",
    "Repeat notification",
    "Confirmation",
  ];

  const renderEditor = (): void => {
    render(
      html`<div class="nc-editor-view">
        <section class="nc-editor-shell">
          <header class="nc-modal-header">
            <h2>${value.id ? "Edit alert" : "Add alert"}</h2>
            <button
              class="nc-button secondary"
              @click=${() => close() && onCancel?.()}
            >
              Back to alerts
            </button>
          </header>
          <main class="nc-modal-body">
            <nav class="nc-section-header">
              ${titles.map(
                (title, index) =>
                  html`<button
                    class="nc-section-nav-button"
                    @click=${() => showSection(index)}
                  >
                    ${title}
                  </button>`,
              )}
            </nav>
            <div class="nc-editor-sections">
              ${renderBasicSection(context)}${renderMonitorSection(
                context,
              )}${renderConditionSection(
                context,
              )}${renderRecipientSection()}${renderNotificationSection(
                context,
              )}${renderRepeatSection(context)}${renderConfirmationSection(
                context,
              )}
            </div>
          </main>
          <footer class="nc-modal-footer">
            <button
              class="nc-button secondary"
              @click=${() => close() && onCancel?.()}
            >
              Cancel</button
            ><button
              class="nc-button secondary"
              ?disabled=${!value.id}
              @click=${test}
            >
              Test alert</button
            ><button class="nc-button secondary" @click=${yamlView}>YAML</button
            ><button class="nc-button" @click=${save}>Save alert</button>
          </footer>
        </section>
      </div>`,
      host,
    );
  };
  renderEditor();
  root.append(host);

  const visual = host.querySelector<HTMLElement>('[data-role="visual"]')!;
  const recipientMount = host.querySelector<HTMLElement>(
    '[data-role="recipients"]',
  )!;
  const visualConditions = visualConditionBuilder(
    visual,
    registries,
    value.conditions,
    context.markDirty,
  );
  const recipients = createRecipientPicker(
    registries,
    value.notification.target,
    context.markDirty,
  );
  recipientMount.replaceChildren(recipients.element);
  const jinja = host.querySelector<HTMLElement>('[data-role="jinja"]')!;

  function refreshStatuses(): void {
    visual.hidden = context.mode !== "visual";
    jinja.hidden = context.mode === "visual";
    const configured = [
      Boolean(value.name.trim() || value.description.trim()),
      Boolean(
        value.monitor.on_change ||
        value.monitor.interval ||
        value.monitor.startup,
      ),
      context.mode === "visual"
        ? visualConditions().length > 0
        : Boolean(conditionTemplate(value).trim()),
      Object.values(recipients.target()).some((items) =>
        Boolean(items?.length),
      ),
      Boolean(
        value.notification.title.trim() || value.notification.message.trim(),
      ),
      Boolean(value.notification.repeat),
      Boolean(value.notification.confirmation.enabled),
    ];
    host
      .querySelectorAll<HTMLElement>(".nc-section-status")
      .forEach((status, index) => {
        status.classList.toggle("active", configured[index]);
        status.setAttribute(
          "aria-label",
          configured[index] ? "Configured" : "Not configured",
        );
      });
  }

  context.refreshStatuses = refreshStatuses;

  function showSection(index: number): void {
    host
      .querySelectorAll<HTMLElement>(".nc-section")
      .forEach((item, itemIndex) =>
        item.classList.toggle("active", itemIndex === index),
      );
    host
      .querySelectorAll<HTMLButtonElement>(".nc-section-nav-button")
      .forEach((button, itemIndex) => {
        const active = itemIndex === index;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
  }
  refreshStatuses();
  function close(): boolean {
    if (dirty && !window.confirm("Discard unsaved changes?")) return false;
    host.remove();
    if (page) page.hidden = false;
    return true;
  }
  function formPayload(): Alert {
    const actionToggle = host.querySelector<HTMLInputElement>(
      '[data-role="actions-toggle"]',
    );
    let actions: Record<string, unknown>[] = [];
    if (actionToggle?.checked) {
      try {
        actions = JSON.parse(
          host.querySelector<HTMLTextAreaElement>('[data-role="actions"]')
            ?.value || "[]",
        );
      } catch {
        actions = [];
      }
    }
    const repeat = value.notification.repeat
      ? {
          interval: String(value.notification.repeat.interval || "00:30"),
          max_attempts: Number(value.notification.repeat.max_attempts) || 5,
        }
      : undefined;
    const confirmation = value.notification.confirmation!;
    return buildAlertPayload(value, {
      name: value.name,
      description: value.description,
      condition: conditionTemplate(value),
      conditions:
        context.mode === "visual"
          ? visualConditions()
          : [{ type: "template", template: conditionTemplate(value) }],
      onChange: value.monitor.on_change,
      startup: value.monitor.startup,
      interval: value.monitor.interval,
      target: recipients.target(),
      title: value.notification.title,
      message: value.notification.message,
      repeat,
      confirmation: {
        enabled: Boolean(confirmation.enabled),
        button: confirmation.button,
        completion_message: confirmation.completion_message,
        resend_interval: String(confirmation.resend_interval),
        max_attempts: confirmation.max_attempts,
        actions_enabled: Boolean(actionToggle?.checked),
        ...(actions.length ? { actions } : {}),
      },
    });
  }
  function yamlView(): void {
    showYaml(root, formPayload());
  }
  async function test(event: Event): Promise<void> {
    const button = event.currentTarget as HTMLButtonElement;
    try {
      if (!value.id) throw new Error("Save the alert before testing it.");
      button.disabled = true;
      await onTest(value.id);
    } catch (error) {
      const toast = document.createElement("div");
      toast.className = "nc-toast";
      toast.textContent = errorMessage(error);
      root.append(toast);
      window.setTimeout(() => toast.remove(), 6000);
    } finally {
      button.disabled = !value.id;
    }
  }
  async function save(event: Event): Promise<void> {
    const button = event.currentTarget as HTMLButtonElement;
    try {
      if (!value.name.trim()) throw new Error("Name is required.");
      if (!conditionTemplate(value).trim())
        throw new Error("Condition is required.");
      if (!value.monitor.on_change && !value.monitor.interval)
        throw new Error("Enable condition changes, an interval, or both.");
      const result = formPayload();
      button.disabled = true;
      await onSave(result);
      Object.assign(value, result);
      dirty = false;
    } catch (error) {
      const toast = document.createElement("div");
      toast.className = "nc-toast";
      toast.textContent = errorMessage(error);
      root.append(toast);
      window.setTimeout(() => toast.remove(), 6000);
    } finally {
      button.disabled = false;
    }
  }
}
