import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import * as YAML from "yaml";
import type { Alert, Hass } from "../types.js";
import {
  type CodeEditor,
  type CodeEditorOptions,
  type EditorContext,
  type EditorMode,
  type FormControl,
  type OptionalSetting,
} from "./types.js";

export function editorModeFor(value: Alert): EditorMode {
  if (!value.conditions.length) {
    return "visual";
  }

  if (
    value.conditions.some((item) =>
      ["state", "numeric", "attribute"].includes(item.type),
    )
  ) {
    return "visual";
  }

  return "jinja";
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
    conditions: [],
    monitor: {
      on_change: true,
      startup: true,
      clear_on_condition_change: true,
      retention: {
        enabled: true,
        days: 30,
      },
    },
    notification: {
      target: {},
      title: "",
      message: "",
    },
    confirmation: {
      enabled: false,
      buttons: [{ id: "confirm", label: "Done" }],
      notification: { enabled: false, message: "", clear: true },
      reminders: {
        enabled: false,
        interval: "00:30:00",
        max_attempts: 5,
        show_attempts: false,
        timeout: "00:15:00",
      },
      actions: { enabled: false, items: [] },
    },
  };
}

export function conditionTemplate(alert: Alert): string {
  return (
    alert.conditions.find((condition) => condition.type === "template")
      ?.template || ""
  );
}

export function conditionsYaml(conditions: Alert["conditions"]): string {
  if (conditions.length) {
    return YAML.stringify(conditions);
  }

  return YAML.stringify([]);
}

export function actionsYaml(
  actions: Record<string, unknown>[] | undefined,
): string {
  if (actions?.length) {
    return YAML.stringify(actions);
  }

  return "";
}

export function parseConditionsYaml(value: string): Alert["conditions"] {
  const parsed = YAML.parse(value || "[]");
  if (!Array.isArray(parsed)) {
    throw new Error("Conditions YAML must be a list.");
  }
  if (!parsed.every((item) => item && typeof item === "object")) {
    throw new Error("Conditions YAML must contain condition objects.");
  }
  return parsed as Alert["conditions"];
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
    new CustomEvent("nc-editor-toast", { detail: { message, duration } }),
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
      aria-label="Duration"
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
    aria-label="Duration (HH:MM:SS)"
    .value=${value}
    @input=${update}
    @blur=${commit}
    @change=${commit}
  ></ha-input>`;
}

export async function fillActionEditors(host: HTMLElement): Promise<void> {
  await customElements.whenDefined("ha-code-editor");

  const editors = Array.from(
    host.querySelectorAll<CodeEditor>("ha-code-editor.nc-action-editor"),
  );

  for (const editor of editors) {
    await editor.updateComplete;
    constrainCodeEditor(editor, "280px");
  }
}

export function constrainCodeEditor(
  editor: CodeEditor,
  height = "var(--nc-code-editor-height)",
): void {
  const codeMirror = editor.codemirror?.dom;
  if (!codeMirror || !editor.isConnected) return;

  if (height) editor.style.height = height;
  codeMirror.style.height = "100%";
  const scroller = codeMirror.querySelector(
    ".cm-scroller",
  ) as HTMLElement | null;
  if (scroller) scroller.style.height = "100%";
}

export function field(
  label: string | TemplateResult,
  content: TemplateResult = html``,
  full = false,
): TemplateResult {
  let className = "nc-field";
  if (full) {
    className = "nc-field full";
  }

  return html`<div class=${className}><label>${label}</label>${content}</div>`;
}

export function codeEditor({
  role,
  value,
  placeholder = "",
  mode,
  language,
  label,
  className = "nc-action-editor",
  readOnly = false,
  onInput,
  onReady,
}: CodeEditorOptions): TemplateResult {
  return html`<ha-code-editor
    data-role=${role || nothing}
    .value=${value}
    placeholder=${placeholder || nothing}
    class=${`nc-code-editor ${className}`}
    mode=${mode}
    language=${language}
    aria-label=${label}
    ?read-only=${readOnly}
    @input=${onInput || nothing}
    @value-changed=${onInput || nothing}
    ${ref((element) => {
      if (element) onReady?.(element as CodeEditor);
    })}
  ></ha-code-editor>`;
}

export function section(
  title: string,
  content: TemplateResult,
  className = "",
  active = false,
): TemplateResult {
  return html`<section
    class="nc-section ${className}${active ? " active" : ""}"
    data-title=${title}
  >
    <div class="nc-section-content">${content}</div>
  </section>`;
}

export function optionalControls(
  context: EditorContext,
  enabled: boolean,
  label: string,
  onToggle: (enabled: boolean) => void,
  disabled = false,
): TemplateResult {
  const stateText = enabledLabel(enabled);
  const title = toggleTitle(enabled, label);

  return html`<div class="nc-setting-controls">
    <span class="nc-setting-state">${stateText}</span>
    <ha-switch
      .checked=${enabled}
      ?disabled=${disabled}
      aria-label=${`Enable ${label}`}
      title=${title}
      @change=${(event: Event) => onToggle(checkedOf(event))}
    ></ha-switch>
  </div>`;
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
    }),
  );
}

export function showTemplateHelp(
  event: Event,
  title: string,
  content: TemplateResult,
): void {
  const trigger = event.currentTarget as HTMLElement | null;
  const root = trigger?.getRootNode();
  if (!(root instanceof ShadowRoot)) return;

  root.dispatchEvent(
    new CustomEvent("nc-editor-modal", {
      detail: {
        kind: "template-help",
        title,
        content,
        modalClass: "nc-template-help-modal",
        closeLabel: "Close template help",
      },
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
