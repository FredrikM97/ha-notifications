import { html } from "lit";
import type { CSSResult, TemplateResult } from "lit";
import * as YAML from "yaml";
import type { Alert, Hass } from "../types.js";
import { localize } from "../localize.js";
import { codeEditor } from "../components/code-editor.js";
import "./section.js";

export { codeEditor };
import {
  ACTIONS_PLACEHOLDER,
  type CodeEditor,
  type ActionEditorRole,
  type EditorContext,
  type EditorMode,
  type FormControl,
  type OptionalSetting,
} from "./types.js";

export function editorModeFor(value: Alert): EditorMode {
  return "yaml";
}

export function isSectionVisible(
  setting: OptionalSetting | undefined,
  settings: Record<OptionalSetting, boolean>,
): boolean {
  return !setting || settings[setting];
}

export function defaultAlert(): Alert {
  return {
    id: `alert_${Date.now()}`,
    name: "",
    enabled: true,
    description: "",
    icon: "mdi:bell-outline",
    triggers: [{ trigger: "homeassistant", event: "start" }],
    conditions: [{ condition: "template", value_template: "{{ true }}" }],
    notification: {
      target: {},
      data: { title: "", message: "" },
    },
    confirmation: {
      enabled: false,
      buttons: [{ id: "confirm", label: "Done" }],
      notification: {
        enabled: false,
        data: { message: "" },
      },
      reminders: {
        enabled: false,
        interval: "00:30:00",
        max_attempts: 5,
        show_attempts: false,
        forget_after_enabled: false,
        timeout: "00:15:00",
      },
      actions: [],
    },
  };
}

export function conditionYaml(condition: Alert["conditions"]): string {
  return YAML.stringify(condition);
}

export function triggerYaml(triggers: Alert["triggers"]): string {
  return triggers.length ? YAML.stringify(triggers) : "";
}

export function customTriggers(
  triggers: Alert["triggers"],
): Alert["triggers"] {
  return triggers.filter((trigger) => !isBuiltInTrigger(trigger));
}

export function confirmationNotificationEnabled(
  notification: NonNullable<Alert["confirmation"]>["notification"],
): boolean {
  if (typeof notification.enabled === "boolean") return notification.enabled;
  return Boolean(
    notification.action ||
      notification.target !== undefined ||
      notification.title !== undefined ||
      notification.message !== undefined ||
      notification.data !== undefined,
  );
}

function isBuiltInTrigger(trigger: Alert["triggers"][number]): boolean {
  return (
    (trigger.trigger === "homeassistant" && trigger.event === "start") ||
    trigger.trigger === "time_pattern"
  );
}

export function mergeCustomTriggers(
  current: Alert["triggers"],
  custom: Alert["triggers"],
): Alert["triggers"] {
  return [...current.filter(isBuiltInTrigger), ...custom];
}

export function parseTriggerYaml(value: string): Alert["triggers"] {
  if (!value.trim()) return [];
  const parsed = YAML.parse(value);
  if (
    Array.isArray(parsed) &&
    parsed.every(
      (item) => item && typeof item === "object" && !Array.isArray(item),
    )
  ) {
    return parsed as Alert["triggers"];
  }
  throw new Error("Triggers YAML must be a list of mappings.");
}

export function actionsYaml(
  actions: Record<string, unknown>[] | undefined,
): string {
  if (actions?.length) {
    return YAML.stringify(actions);
  }

  return "";
}

export function parseConditionYaml(value: string): Alert["conditions"] {
  const parsed = YAML.parse(value);
  if (Array.isArray(parsed) && parsed.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
    return parsed as Alert["conditions"];
  }
  throw new Error("Conditions YAML must be a list of mappings.");
}

export function valueOf(event: Event): string {
  return (event.currentTarget as FormControl).value;
}

export function checkedOf(event: Event): boolean {
  return (event.currentTarget as HTMLInputElement).checked;
}

export function showEditorToast(
  root: ShadowRoot,
  message: string,
  duration = 6000,
): void {
  root.dispatchEvent(
    new CustomEvent("nc-editor-toast", {
      detail: { message, duration },
      bubbles: true,
      composed: true,
    }),
  );
}

export function durationInputValue(
  value: string | number | Record<string, number> | undefined,
  fallback: string,
): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const totalSeconds = Math.max(0, Math.floor(value));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
  }
  if (typeof value === "string") {
    const parts = value.split(":");
    if (parts.length === 2) return `${value}:00`;
    return value;
  }
  if (!value || typeof value !== "object") return fallback;

  const totalSeconds = Math.max(
    0,
    Math.floor(
      (Number(value.days) || 0) * 86400 +
        (Number(value.hours) || 0) * 3600 +
        (Number(value.minutes) || 0) * 60 +
        (Number(value.seconds) || 0),
    ),
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

// Native <input type="time"> hands off to the OS clock widget on mobile,
// which commonly only supports HH:MM (12-hour, with AM/PM), silently drops
// seconds, caps at 24h, and misreads the hour. A masked plain-text field
// avoids the native picker entirely: digits fill right-to-left (like a
// calculator), so "HH:MM:SS" is always captured correctly and hours can
// exceed 24 (e.g. a 100-hour reminder interval).
export function durationInput(
  value: string,
  onChange: (next: string) => void,
  hass?: Hass,
  label?: string,
): TemplateResult {
  if (hass) {
    return html`<ha-selector
      class="nc-duration-input"
      .hass=${hass}
      .selector=${{ duration: { enable_day: true, enable_second: true } }}
      .value=${value}
      .label=${label || undefined}
      aria-label=${localize(hass, "editor.common.duration")}
      @value-changed=${(event: CustomEvent<{ value?: unknown }>) => {
        onChange(
          durationInputValue(
            event.detail.value as
              | string
              | number
              | Record<string, number>
              | undefined,
            value,
          ),
        );
      }}
    ></ha-selector>`;
  }

  const normalize = (raw: string): string => {
    const parts = raw.replace(/[^\d:]/g, "").split(":");
    const seconds = Number(parts.pop() || 0);
    const minutes = Number(parts.pop() || 0);
    const hours = Number(parts.join("") || 0);
    return `${hours}:${String(Math.min(minutes, 59)).padStart(2, "0")}:${String(
      Math.min(seconds, 59),
    ).padStart(2, "0")}`;
  };
  const update = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement;
    onChange(input.value);
  };
  const commit = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement;
    onChange(normalize(input.value));
  };

  return html`<ha-input
    class="nc-duration-input"
    type="text"
    inputmode="numeric"
    placeholder="HH:MM:SS"
    aria-label=${localize(hass, "editor.common.duration_format")}
    .value=${value}
    @input=${update}
    @blur=${commit}
    @change=${commit}
  ></ha-input>`;
}

export function actionSection({
  context,
  title,
  help,
  role,
  actions,
}: {
  context: EditorContext;
  title: string;
  help: string;
  role: ActionEditorRole;
  actions: Record<string, unknown>[] | undefined;
}): TemplateResult {
  return section(
    title,
    html`<div class="nc-help">${help}</div>
      ${codeEditor({
        role,
        value: actionsYaml(actions),
        hass: context.hass,
        visualType: "action",
        placeholder: ACTIONS_PLACEHOLDER,
        mode: "yaml",
        language: "yaml",
        label: title,
        onInput: () => context.markDirty(),
        onReady: (editor) => context.setEditorControl(role, editor),
      })}`,
    "",
    context.activeSection === title,
  );
}

export function section(
  title: string,
  content: TemplateResult,
  className = "",
  active = false,
  featureStyles?: CSSResult,
): TemplateResult {
  return html`<ha-notifications-editor-section
    class="nc-section ${className}${active ? " active" : ""}"
    data-title=${title}
    .title=${title}
    .content=${content}
    .featureStyles=${featureStyles?.cssText || ""}
  ></ha-notifications-editor-section>`;
}

export function optionalControls(
  context: EditorContext,
  setting: OptionalSetting,
  enabled: boolean,
  label: string,
  disabled = false,
): TemplateResult {
  return html`<ha-notifications-setting-toggle
    .setting=${setting}
    .enabled=${enabled}
    .label=${label}
    .enableText=${context.localize("alert.enable")}
    .disableText=${context.localize("alert.disable")}
    ?disabled=${disabled}
  ></ha-notifications-setting-toggle>`;
}

export function editorSectionControl(
  setting: OptionalSetting,
  content: TemplateResult,
  visible = false,
): TemplateResult {
  return html`<div
    data-role="editor-section-control"
    data-setting=${setting}
    ?hidden=${!visible}
  >
    ${content}
  </div>`;
}

export function enabledLabel(enabled: boolean): string {
  return enabled ? "Enabled" : "Disabled";
}

export function toggleTitle(enabled: boolean, label: string): string {
  return enabled ? `Disable ${label}` : `Enable ${label}`;
}

export function showYaml(root: ShadowRoot, alert: Alert): void {
  root.dispatchEvent(
    new CustomEvent("nc-editor-modal", {
      detail: { kind: "yaml", alert },
      bubbles: true,
      composed: true,
    }),
  );
}

export function actionArrayValue(
  editor: CodeEditor | null,
  label: string,
): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = YAML.parse(editor?.value || "[]");
  } catch {
    throw new Error(
      `${label} must be a valid YAML list of action objects. Example: - action: switch.turn_on`,
    );
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => item && typeof item === "object")
  ) {
    throw new Error(`${label} must be a YAML list of action objects.`);
  }
  return parsed as Record<string, unknown>[];
}
