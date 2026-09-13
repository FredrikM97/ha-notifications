import { errorMessage } from "./api.js";
import { buildAlertPayload } from "./alert-payload.js";
import { visualConditionBuilder } from "./condition-builder.js";
import { createRecipientPicker } from "./recipient-picker.js";
import { html, nothing, render } from "lit";
import type { TemplateResult } from "lit";
import type { Alert, Registries } from "./types.js";

type FormControl = HTMLInputElement | HTMLTextAreaElement;
type CodeEditor = HTMLElement & {
  value: string;
  updateComplete?: Promise<unknown>;
  codemirror?: { dom: HTMLElement };
};
type EditorMode = "visual" | "jinja";

interface EditorContext {
  value: Alert;
  mode: EditorMode;
  markDirty(): void;
  refreshStatuses(): void;
  removeSetting(setting: OptionalSetting): void;
}

type OptionalSetting =
  | "repeat"
  | "confirmation"
  | "postSendActions"
  | "postConfirmationActions";

type OptionalSettings = Record<OptionalSetting, boolean>;
type SectionStatus = OptionalSetting | "confirmationUpdate";

interface EditorSection {
  title: string;
  setting?: OptionalSetting;
  parent?: string;
  status?: SectionStatus;
}

interface OptionalSection {
  index: number;
}

const editorSections: EditorSection[] = [
  { title: "Basic" },
  { title: "When to check" },
  { title: "Condition" },
  { title: "Recipients" },
  { title: "Notification" },
  {
    title: "Post-send actions",
    setting: "postSendActions",
    parent: "Notification",
    status: "postSendActions",
  },
  { title: "Repeat notification", setting: "repeat", status: "repeat" },
  { title: "Confirmation", setting: "confirmation", status: "confirmation" },
  {
    title: "Notify recipients when confirmed",
    parent: "Confirmation",
    status: "confirmationUpdate",
  },
  {
    title: "Post-confirmation actions",
    setting: "postConfirmationActions",
    parent: "Confirmation",
    status: "postConfirmationActions",
  },
];

const optionalSections: Record<OptionalSetting, OptionalSection> = {
  postSendActions: { index: 5 },
  repeat: { index: 6 },
  confirmation: { index: 7 },
  postConfirmationActions: { index: 9 },
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function editorModeFor(value: Alert): EditorMode {
  if (
    value.conditions.some((item) =>
      ["state", "numeric", "attribute"].includes(item.type),
    )
  ) {
    return "visual";
  }

  return "jinja";
}

function sectionForSetting(setting: OptionalSetting): OptionalSection {
  return optionalSections[setting];
}

function isSectionVisible(
  setting: OptionalSetting | undefined,
  settings: OptionalSettings,
): boolean {
  return !setting || settings[setting];
}

function defaultAlert(): Alert {
  return {
    id: `alert_${Date.now()}`,
    name: "",
    enabled: true,
    description: "",
    icon: "mdi:bell-outline",
    conditions: [{ type: "template", template: "" }],
    monitor: { on_change: true, startup: true },
    notification: {
      action: "notify.send_message",
      target: {},
      title: "",
      message: "",
      actions_enabled: false,
      confirmation: {
        enabled: true,
        button: "",
        completion_message: "",
        notify_on_confirmation: false,
        confirmation_message: "",
        clear_on_confirmation: true,
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
      ?.template || ""
  );
}

function valueOf(event: Event): string {
  return (event.currentTarget as FormControl).value;
}

function checkedOf(event: Event): boolean {
  return (event.currentTarget as HTMLInputElement).checked;
}

async function fillActionEditors(host: HTMLElement): Promise<void> {
  await customElements.whenDefined("ha-code-editor");

  const editors = Array.from(
    host.querySelectorAll<CodeEditor>("ha-code-editor.nc-action-editor"),
  );

  for (const editor of editors) {
    await editor.updateComplete;
    const codeMirror = editor.codemirror?.dom;
    if (!codeMirror || !editor.isConnected) continue;

    editor.style.height = "280px";
    codeMirror.style.height = "100%";
    const scroller = codeMirror.querySelector(
      ".cm-scroller",
    ) as HTMLElement | null;
    if (scroller) scroller.style.height = "100%";
  }
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
  controls: TemplateResult | typeof nothing = nothing,
): TemplateResult {
  return html`<section class="nc-section ${className}" data-title=${title}>
    <header class="nc-section-titlebar"><h2>${title}</h2>${controls}</header>
    <div class="nc-section-content">${content}</div>
  </section>`;
}

function subpanel(
  title: string,
  subtitle: string,
  content: TemplateResult,
): TemplateResult {
  return html`<div class="nc-subpanel">
    <div class="nc-subpanel-header">
      <span class="nc-subpanel-heading">
        <span class="nc-subpanel-title">${title}</span>
        <span class="nc-subpanel-subtitle">${subtitle}</span>
      </span>
    </div>
    <div class="nc-subpanel-content">${content}</div>
  </div>`;
}

function optionalControls(
  context: EditorContext,
  setting: OptionalSetting,
  enabled: boolean,
  label: string,
  onToggle: (enabled: boolean) => void,
  disabled = false,
): TemplateResult {
  return html`<div class="nc-setting-controls">
    <span class="nc-setting-state">${enabled ? "Enabled" : "Disabled"}</span>
    <input
      class="nc-switch-input"
      type="checkbox"
      role="switch"
      .checked=${enabled}
      ?disabled=${disabled}
      aria-label=${`Enable ${label}`}
      title=${enabled ? `Disable ${label}` : `Enable ${label}`}
      @change=${(event: Event) => onToggle(checkedOf(event))}
    />
    <button class="nc-icon-button danger" type="button" aria-label=${`Remove ${label}`} title=${`Remove ${label}`} @click=${() => context.removeSetting(setting)}><ha-icon icon="mdi:trash-can-outline"></ha-icon></button>
  </div>`;
}

function confirmationNotificationControls(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.notification.confirmation;
  const enabled = Boolean(confirmation.notify_on_confirmation);

  return html`<label class="nc-switch-label">
    <span class="nc-setting-state">${enabled ? "Enabled" : "Disabled"}</span>
    <input
      class="nc-switch-input"
      type="checkbox"
      role="switch"
      .checked=${enabled}
      aria-label="Notify recipients when confirmed"
      title="Notify recipients when confirmed"
      @change=${(event: Event) => {
        confirmation.notify_on_confirmation = checkedOf(event);
        context.markDirty();
      }}
    />
  </label>`;
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
            placeholder="{{ is_state('binary_sensor.example', 'on') }}"
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
      </div>
      <div class="nc-help">
        Mobile App-only recipients use legacy Mobile App delivery. Mixed or
        non-mobile recipients use standard Notify delivery.
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
            .value=${notification.title}
            placeholder="Notification title"
            @input=${(event: Event) => {
              notification.title = valueOf(event);
              context.markDirty();
              context.refreshStatuses();
            }}
          />`,
        )}
        ${field(
          "Message",
          html`<ha-code-editor
            .value=${notification.message || ""}
            placeholder="Notification message"
            class="nc-code-editor nc-action-editor"
            mode="jinja2"
            language="jinja"
            aria-label="Notification message"
            @input=${(event: Event) => {
              notification.message = (
                event.currentTarget as CodeEditor
              ).value;
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-code-editor>`,
          true,
        )}
      </div>
      <div class="nc-help">
        Recipients on selected devices, areas, floors, and labels receive direct
        Mobile App notifications when a matching notifier is available.
      </div>`,
  );
}

function renderPostSendActionsSection(context: EditorContext): TemplateResult {
  const notification = context.value.notification;
  return section(
    "Post-send actions",
    html`<div class="nc-help">
        Runs after every notification send. Enter a JSON array of Home
        Assistant actions. JSON is valid YAML; YAML syntax and Jinja templates
        are highlighted, but only JSON arrays can be saved.
      </div>
      <ha-code-editor
        data-role="notification-actions"
        class="nc-code-editor nc-action-editor"
        mode="yaml"
        language="yaml"
        aria-label="Post-send actions"
        .value=${JSON.stringify(notification.actions || [], null, 2)}
        @input=${() => context.markDirty()}
      ></ha-code-editor>`,
    "",
    optionalControls(context, "postSendActions", Boolean(notification.actions_enabled), "post-send actions", (enabled) => {
      notification.actions_enabled = enabled;
      context.markDirty();
    }),
  );
}

function renderRepeatSection(context: EditorContext): TemplateResult {
  const repeat = context.value.notification.repeat;
  return section(
    "Repeat notification",
    html`<div class="nc-grid">
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
    "",
    optionalControls(context, "repeat", repeat?.enabled !== false, "repeat notification", (enabled) => {
      if (repeat) repeat.enabled = enabled;
      context.markDirty();
    }),
  );
}

function renderConfirmationSection(context: EditorContext): TemplateResult {
  const confirmation = context.value.notification.confirmation;
  return section(
    "Confirmation",
    html`<div class="nc-grid">
        ${field(
          "Button text",
          html`<input
            type="text"
            .value=${confirmation.button}
            placeholder="Activity completed"
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
      </div>
      <label class="nc-switch-label nc-confirmation-clear">
        <input
          class="nc-switch-input"
          type="checkbox"
          role="switch"
          .checked=${confirmation.clear_on_confirmation !== false}
          @change=${(event: Event) => {
            confirmation.clear_on_confirmation = checkedOf(event);
            context.markDirty();
          }}
        />
        <span>Clear notifications when acknowledged</span>
      </label>
      <div class="nc-help">
        Confirmation buttons require at least one Mobile App recipient.
      </div>
      `,
    "",
    optionalControls(context, "confirmation", Boolean(confirmation.enabled), "confirmation", (enabled) => {
      confirmation.enabled = enabled;
      context.markDirty();
    }),
  );
}

function renderConfirmationNotificationSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.notification.confirmation;
  return section(
    "Notify recipients when confirmed",
    html`<ha-code-editor
      .value=${confirmation.confirmation_message || ""}
      placeholder="Confirmed by {{ confirmed_by }}"
      class="nc-code-editor nc-action-editor"
      mode="jinja2"
      language="jinja"
      aria-label="Confirmation message"
      @input=${(event: Event) => {
        confirmation.confirmation_message = (
          event.currentTarget as CodeEditor
        ).value;
        context.markDirty();
      }}
    ></ha-code-editor>`,
    "",
    confirmationNotificationControls(context),
  );
}

function renderPostConfirmationActionsSection(
  context: EditorContext,
): TemplateResult {
  const confirmation = context.value.notification.confirmation;
  return section(
    "Post-confirmation actions",
    html`<div class="nc-help">
        Runs after a recipient confirms. Enter a JSON array of Home Assistant
        actions. JSON is valid YAML; YAML syntax and Jinja templates are
        highlighted, but only JSON arrays can be saved.
      </div>
      <ha-code-editor
        data-role="actions"
        class="nc-code-editor nc-action-editor"
        mode="yaml"
        language="yaml"
        aria-label="Post-confirmation actions"
        .value=${JSON.stringify(confirmation.actions || [], null, 2)}
        @input=${() => context.markDirty()}
      ></ha-code-editor>`,
    "",
    optionalControls(context, "postConfirmationActions", Boolean(confirmation.actions_enabled), "post-confirmation actions", (enabled) => {
      confirmation.actions_enabled = enabled;
      context.markDirty();
    }),
  );
}

function setMode(context: EditorContext, mode: EditorMode): void {
  context.mode = mode;
  context.markDirty();
  context.refreshStatuses();
}

function yamlValue(value: unknown, indent = 0): string {
  const padding = " ".repeat(indent);
  const isComplex = (item: unknown): boolean =>
    Array.isArray(item) || Boolean(item && typeof item === "object");

  if (Array.isArray(value)) {
    if (!value.length) return `${padding}[]`;
    return value
      .map((item) =>
        isComplex(item)
          ? `${padding}-\n${yamlValue(item, indent + 2)}`
          : `${padding}- ${yamlValue(item)}`,
      )
      .join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return `${padding}{}`;
    return entries
      .map(([key, item]) =>
        isComplex(item)
          ? `${padding}${key}:\n${yamlValue(item, indent + 2)}`
          : `${padding}${key}: ${yamlValue(item)}`,
      )
      .join("\n");
  }
  return typeof value === "string"
    ? JSON.stringify(value)
    : String(value ?? "null");
}

function showYaml(root: ShadowRoot, alert: Alert): void {
  const popup = document.createElement("div");
  const close = (): void => popup.remove();
  render(
    html`<div
      class="nc-modal-backdrop"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section class="nc-modal nc-alert-yaml-modal">
        <header class="nc-modal-header">
          <h2>Alert YAML</h2>
          <button class="nc-icon-button" @click=${close} aria-label="Close YAML" title="Close YAML">
            <ha-icon icon="mdi:close"></ha-icon>
          </button>
        </header>
        <main class="nc-modal-body">
          <ha-code-editor
            mode="yaml"
            language="yaml"
            read-only
            class="nc-code-editor nc-alert-yaml-editor"
          ></ha-code-editor>
        </main>
      </section>
    </div>`,
    popup,
  );
  const editor = popup.querySelector<CodeEditor>("ha-code-editor");
  if (!editor) throw new Error("Missing alert YAML editor");
  editor.value = yamlValue(alert);
  root.append(popup);
}

function actionArrayValue(
  editor: CodeEditor | null,
  label: string,
): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(editor?.value || "[]");
  } catch {
    throw new Error(`${label} must be a valid JSON array.`);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => item && typeof item === "object")) {
    throw new Error(`${label} must be a JSON array of action objects.`);
  }
  return parsed as Record<string, unknown>[];
}

export function openEditor({
  root,
  alert,
  registries,
  onSave,
  onTest,
  onDiscardTest,
}: {
  root: ShadowRoot;
  alert?: Alert;
  registries: Registries;
  onSave: (alert: Alert) => Promise<void>;
  onTest: (alert: Alert) => Promise<{ session_id: string }>;
  onDiscardTest: (sessionId: string) => Promise<unknown>;
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
  const dashboardContent = page?.querySelector<HTMLElement>(
    "#alerts-view, #history-view, #yaml-view",
  );
  const dashboardTabs = page?.querySelector<HTMLElement>(".nc-tabs");
  const dashboardActions = page?.querySelector<HTMLElement>(".nc-actions");
  if (dashboardContent) dashboardContent.hidden = true;
  if (dashboardTabs) dashboardTabs.hidden = true;
  if (dashboardActions) {
    const backButton = document.createElement("button");
    backButton.className = "nc-button secondary";
    backButton.textContent = "Back to alerts";
    backButton.addEventListener("click", close);
    dashboardActions.replaceChildren(backButton);
  }
  const restoreDashboardAction = (): void => {
    if (!dashboardActions) return;

    const addButton = document.createElement("button");
    addButton.className = "nc-button";
    addButton.textContent = "+ Add alert";
    addButton.addEventListener("click", () => {
      const panel = root.host as HTMLElement & {
        addAlert?: () => Promise<void>;
      };
      void panel.addAlert?.();
    });
    dashboardActions.replaceChildren(addButton);
  };
  let dirty = false;
  let draftTestSessionId: string | null = null;
  const context: EditorContext = {
    value,
    mode: editorModeFor(value),
    markDirty: () => {
      dirty = true;
      refreshStatuses();
    },
    refreshStatuses: () => {},
    removeSetting: () => {},
  };
  const optionalSettings: OptionalSettings = {
    repeat: Boolean(value.notification.repeat),
    confirmation: !alert || Boolean(alert.notification.confirmation),
    postSendActions: true,
    postConfirmationActions: !alert || Boolean(alert.notification.confirmation),
  };
  const collapsedParents = new Set<string>();
  const renderEditor = (): void => {
    render(
      html`<div class="nc-editor-view">
        <section class="nc-editor-shell">
          <main class="nc-modal-body">
            <div class="nc-editor-layout">
            <nav class="nc-section-header" aria-label="Alert sections">
              <select
                class="nc-add-setting"
                aria-label="Add setting"
                @change=${(event: Event) => addSetting(valueOf(event))}
              >
                <option value="">Add setting</option>
                <option value="repeat" ?disabled=${optionalSettings.repeat}>
                  Repeat notification
                </option>
                <option
                  value="confirmation"
                  ?disabled=${optionalSettings.confirmation}
                >
                  Confirmation and confirmation notification
                </option>
              </select>
              ${editorSections.map(
                ({ title, setting, parent, status }, index) => {
                  const hasChildren = editorSections.some(
                    (section) => section.parent === title,
                  );
                  return html`
                  <div
                    class="nc-section-nav-row"
                    data-setting=${setting || nothing}
                    data-parent=${parent || nothing}
                    ?hidden=${
                      !isSectionVisible(setting, optionalSettings) ||
                      (parent === "Confirmation" &&
                        !optionalSettings.confirmation)
                    }
                  >
                    <button
                      class="nc-section-nav-button ${setting ? "nc-optional-setting" : ""} ${
                        parent ? "nc-section-nav-child" : ""
                      }"
                      @click=${() => showSection(index)}
                    >
                      ${status
                        ? html`<span
                            class="nc-section-status"
                            data-status=${status}
                            aria-hidden="true"
                          ></span>`
                        : nothing}
                      <span>${title}</span>
                    </button>
                    ${hasChildren
                      ? html`<button
                          class="nc-section-collapse-button"
                          type="button"
                          aria-label=${`Collapse ${title} subpanels`}
                          title=${`Collapse ${title} subpanels`}
                          aria-expanded="true"
                          data-collapse-parent=${title}
                          @click=${() => toggleSidebarChildren(title)}
                        ><ha-icon icon="mdi:chevron-down"></ha-icon></button>`
                      : nothing}
                  </div>`;
                },
              )}
            </nav>
            <select
              class="nc-section-select"
              aria-label="Alert section"
              @change=${(event: Event) => showSection(Number(valueOf(event)))}
            >
              ${editorSections.map(
                ({ title, setting, parent }, index) => html`<option
                  value=${index}
                  ?disabled=${
                    !isSectionVisible(setting, optionalSettings) ||
                    (parent === "Confirmation" &&
                      !optionalSettings.confirmation)
                  }
                >
                  ${title}
                </option>`,
              )}
            </select>
            <div class="nc-editor-sections">
              ${renderBasicSection(context)}${renderMonitorSection(
                context,
              )}${renderConditionSection(
                context,
              )}${renderRecipientSection()}${renderNotificationSection(
                context,
              )}<div
                class="nc-optional-setting"
                data-setting="postSendActions"
                ?hidden=${!optionalSettings.postSendActions}
              >
                ${renderPostSendActionsSection(context)}
              </div><div
                class="nc-optional-setting"
                data-setting="repeat"
                ?hidden=${!optionalSettings.repeat}
              >
                ${renderRepeatSection(context)}
              </div><div
                class="nc-optional-setting"
                data-setting="confirmation"
                ?hidden=${!optionalSettings.confirmation}
              >
                ${renderConfirmationSection(context)}
              </div><div
                class="nc-optional-setting"
                data-setting="confirmation"
                ?hidden=${!optionalSettings.confirmation}
              >
                ${renderConfirmationNotificationSection(context)}
              </div><div
                class="nc-optional-setting"
                data-setting="postConfirmationActions"
                ?hidden=${!optionalSettings.postConfirmationActions}
              >
                ${renderPostConfirmationActionsSection(context)}
              </div>
            </div>
            </div>
          </main>
          <footer class="nc-modal-footer">
            <button
              class="nc-icon-button"
              type="button"
              aria-label="View alert YAML"
              title="View alert YAML"
              aria-expanded="false"
              @click=${yamlView}
            ><ha-icon icon="mdi:code-braces"></ha-icon></button>
            <button
              class="nc-button secondary"
              @click=${close}
            >
              Cancel</button
            ><button
              class="nc-button secondary"
              @click=${test}
            >
              Test alert</button
            ><button class="nc-button" @click=${save}>Save alert</button>
          </footer>
        </section>
      </div>`,
      host,
    );
  };
  renderEditor();
  if (page) page.append(host);
  else root.append(host);
  void fillActionEditors(host);

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
    const enabled: Record<SectionStatus, boolean> = {
      postSendActions: Boolean(value.notification.actions_enabled),
      repeat: Boolean(value.notification.repeat?.enabled !== false),
      confirmation: Boolean(value.notification.confirmation.enabled),
      confirmationUpdate: Boolean(
        value.notification.confirmation.notify_on_confirmation,
      ),
      postConfirmationActions: Boolean(
        value.notification.confirmation.enabled &&
          value.notification.confirmation.actions_enabled,
      ),
    };
    host
      .querySelectorAll<HTMLElement>(".nc-section-status")
      .forEach((indicator) => {
        const status = indicator.dataset.status as SectionStatus | undefined;
        const isEnabled = Boolean(status && enabled[status]);
        indicator.classList.toggle("active", isEnabled);
        indicator.setAttribute(
          "aria-label",
          isEnabled ? "Enabled" : "Disabled",
        );
      });
  }

  context.refreshStatuses = refreshStatuses;

  function addSetting(setting: string): void {
    if (setting === "repeat") {
      value.notification.repeat ||= {
        interval: "00:30",
        max_attempts: 5,
        enabled: true,
      };
      optionalSettings.repeat = true;
    } else if (setting === "confirmation") {
      value.notification.confirmation.enabled = true;
      optionalSettings.confirmation = true;
      optionalSettings.postConfirmationActions = true;
    } else return;

    host
      .querySelectorAll<HTMLElement>(`[data-setting="${setting}"]`)
      .forEach((item) => (item.hidden = false));
    const select = host.querySelector<HTMLSelectElement>(".nc-add-setting");
    const option = select?.querySelector<HTMLOptionElement>(
      `option[value="${setting}"]`,
    );
    if (option) option.disabled = true;
    const sectionIndex = sectionForSetting(setting as OptionalSetting).index;
    const mobileOption = host.querySelector<HTMLOptionElement>(
      `.nc-section-select option[value="${sectionIndex}"]`,
    );
    if (mobileOption) mobileOption.disabled = false;
    if (setting === "confirmation") {
      setOptionalSettingVisible("postConfirmationActions", true);
    }
    if (select) select.value = "";
    context.markDirty();
    refreshStatuses();
  }

  function removeSetting(setting: OptionalSetting): void {
    if (setting === "repeat") {
      delete value.notification.repeat;
    } else if (setting === "postSendActions") {
      delete value.notification.actions;
      value.notification.actions_enabled = false;
    } else if (setting === "postConfirmationActions") {
      delete value.notification.confirmation.actions;
      value.notification.confirmation.actions_enabled = false;
    } else {
      value.notification.confirmation = {
        enabled: false,
        button: "",
        completion_message: "",
        notify_on_confirmation: false,
        confirmation_message: "",
        clear_on_confirmation: true,
        resend_interval: "00:30:00",
        max_attempts: 5,
        actions_enabled: false,
      };
      optionalSettings.postConfirmationActions = false;
      setOptionalSettingVisible("postConfirmationActions", false);
    }
    optionalSettings[setting] = false;
    setOptionalSettingVisible(setting, false);
    context.markDirty();
    showSection(0);
  }

  context.removeSetting = removeSetting;

  function setOptionalSettingVisible(
    setting: OptionalSetting,
    visible: boolean,
  ): void {
    host
      .querySelectorAll<HTMLElement>(`[data-setting="${setting}"]`)
      .forEach((item) => (item.hidden = !visible));
    const sectionIndex = sectionForSetting(setting).index;
    const mobileOption = host.querySelector<HTMLOptionElement>(
      `.nc-section-select option[value="${sectionIndex}"]`,
    );
    if (mobileOption) mobileOption.disabled = !visible;
    const addOption = host.querySelector<HTMLOptionElement>(
      `.nc-add-setting option[value="${setting}"]`,
    );
    if (addOption) addOption.disabled = visible;
  }

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
    const select = host.querySelector<HTMLSelectElement>(".nc-section-select");
    if (select) select.value = String(index);
  }

  function toggleSidebarChildren(parent: string): void {
    const collapsed = !collapsedParents.has(parent);
    if (collapsed) collapsedParents.add(parent);
    else collapsedParents.delete(parent);

    host
      .querySelectorAll<HTMLElement>(`.nc-section-nav-row[data-parent="${parent}"]`)
      .forEach((row) => {
        const setting = row.dataset.setting as OptionalSetting | undefined;
        row.hidden = collapsed || !isSectionVisible(setting, optionalSettings);
      });

    const button = host.querySelector<HTMLButtonElement>(
      `[data-collapse-parent="${parent}"]`,
    );
    if (button) {
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute(
        "aria-label",
        `${collapsed ? "Expand" : "Collapse"} ${parent} subpanels`,
      );
      button.setAttribute(
        "title",
        `${collapsed ? "Expand" : "Collapse"} ${parent} subpanels`,
      );
      const icon = button.querySelector<HTMLElement>("ha-icon");
      if (icon) icon.setAttribute("icon", collapsed ? "mdi:chevron-right" : "mdi:chevron-down");
    }
  }
  refreshStatuses();
  showSection(0);
  async function discardDraftTest(): Promise<void> {
    const sessionId = draftTestSessionId;
    draftTestSessionId = null;
    if (!sessionId) return;
    try {
      await onDiscardTest(sessionId);
    } catch {
      // The server-side TTL releases drafts if this best-effort cleanup fails.
    }
  }
  function close(): boolean {
    if (dirty && !window.confirm("Discard unsaved changes?")) return false;
    void discardDraftTest();
    host.remove();
    if (dashboardContent) dashboardContent.hidden = false;
    if (dashboardTabs) dashboardTabs.hidden = false;
    restoreDashboardAction();
    return true;
  }
  function formPayload(): Alert {
    let actions: Record<string, unknown>[] = [];
    if (optionalSettings.postConfirmationActions) {
      actions = actionArrayValue(
        host.querySelector<CodeEditor>('[data-role="actions"]'),
        "Post-confirmation actions",
      );
    }
    const repeat = value.notification.repeat
      ? {
          interval: String(value.notification.repeat.interval || "00:30"),
          max_attempts: Number(value.notification.repeat.max_attempts) || 5,
          enabled: value.notification.repeat.enabled !== false,
        }
      : undefined;
    let notificationActions: Record<string, unknown>[] = [];
    if (optionalSettings.postSendActions) {
      notificationActions = actionArrayValue(
        host.querySelector<CodeEditor>('[data-role="notification-actions"]'),
        "Post-send actions",
      );
    }
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
      actions_enabled: Boolean(value.notification.actions_enabled),
      ...(notificationActions.length ? { actions: notificationActions } : {}),
      confirmation: {
        enabled: Boolean(confirmation.enabled),
        button: confirmation.button,
        completion_message: confirmation.completion_message,
        notify_on_confirmation: Boolean(confirmation.notify_on_confirmation),
        confirmation_message: confirmation.confirmation_message,
        clear_on_confirmation: confirmation.clear_on_confirmation !== false,
        resend_interval: String(confirmation.resend_interval),
        max_attempts: confirmation.max_attempts,
        actions_enabled: Boolean(confirmation.actions_enabled),
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
      button.disabled = true;
      await discardDraftTest();
      const result = await onTest(formPayload());
      draftTestSessionId = result.session_id;
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
      await discardDraftTest();
      await onSave(result);
      Object.assign(value, result);
      dirty = false;
      close();
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
