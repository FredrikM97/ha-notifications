import { html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import type { EditorSectionContext } from "../editor/types.js";
import { codeEditor } from "../components/code-editor.js";
import { durationInputValue } from "../components/duration-input.js";
import { checkedValue } from "../components/form-controls.js";
import { renderFormField } from "../components/form-field.js";
import { customTriggers } from "../editor/triggers.js";
import { triggerYaml } from "../editor/serialization.js";
import { renderEditorSection } from "../editor/section.js";

function hasStartupTrigger(context: EditorSectionContext): boolean {
  return context.value.triggers.some(
    (trigger) =>
      trigger.trigger === "homeassistant" && trigger.event === "start",
  );
}

function intervalTrigger(context: EditorSectionContext): Record<string, unknown> | undefined {
  return context.value.triggers.find(
    (trigger) => trigger.trigger === "time_pattern",
  );
}

export const DEFAULT_INTERVAL = "12:00:00";

export function intervalValue(trigger: Record<string, unknown> | undefined): string {
  if (!trigger) return DEFAULT_INTERVAL;
  if (typeof trigger.hours === "string") return `${Number(trigger.hours.slice(1))}:00:00`;
  if (trigger.hours === 0 || trigger.hours === "0") return "24:00:00";
  if (typeof trigger.minutes === "string") return `00:${String(Number(trigger.minutes.slice(1))).padStart(2, "0")}:00`;
  if (typeof trigger.seconds === "string") return `00:00:${String(Number(trigger.seconds.slice(1))).padStart(2, "0")}`;
  return DEFAULT_INTERVAL;
}

// HA time_pattern divisors are limited to hours /1-/23 and minutes/seconds /1-/59.
export function patternForDuration(value: string): Record<string, unknown> {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  const total = hours * 3600 + minutes * 60 + seconds;
  if (!Number.isFinite(total) || total <= 0) {
    return patternForDuration(DEFAULT_INTERVAL);
  }
  if (total >= 86400) return { trigger: "time_pattern", hours: 0, minutes: 0, seconds: 0 };
  if (total >= 3600) {
    return { trigger: "time_pattern", hours: `/${Math.min(23, Math.round(total / 3600))}` };
  }
  if (total >= 60) {
    return { trigger: "time_pattern", minutes: `/${Math.min(59, Math.round(total / 60))}` };
  }
  return { trigger: "time_pattern", seconds: `/${total}` };
}

export function renderTriggerSection(
  context: EditorSectionContext<"hass">,
): TemplateResult {
  const trigger = intervalTrigger(context);
  return renderEditorSection(
    context.localize("editor.triggers.section"),
    html`<div class="nc-trigger-setting">
      <div class="nc-help">${context.localize("editor.triggers.built_in_help")}</div>
      ${triggerSettingsContent(context, trigger)}
    </div>`,
    "",
    context.activeSection === "When to run",
  );
}

function triggerSettingsContent(
  context: EditorSectionContext<"hass">,
  trigger: Record<string, unknown> | undefined,
): TemplateResult {
  return html`${renderFormField(
    context.localize("editor.triggers.startup"),
    html`<ha-switch
      .checked=${hasStartupTrigger(context)}
      aria-label=${context.localize("editor.triggers.startup")}
      @change=${(event: Event) => {
        const enabled = checkedValue(event);
        context.value.triggers = context.value.triggers.filter(
          (item) =>
            !(item.trigger === "homeassistant" && item.event === "start"),
        );
        if (enabled) {
          context.value.triggers.push({ trigger: "homeassistant", event: "start" });
        }
        context.markDirty();
      }}
    ></ha-switch>`,
    true,
  )}
  <div class="nc-help">${context.localize("editor.triggers.startup_help")}</div>
  ${renderFormField(
    context.localize("editor.triggers.interval"),
    html`<ha-switch
      .checked=${Boolean(trigger)}
      aria-label=${context.localize("editor.triggers.interval")}
      @change=${(event: Event) => {
        const enabled = checkedValue(event);
        context.value.triggers = context.value.triggers.filter(
          (item) => item.trigger !== "time_pattern",
        );
        if (enabled) context.value.triggers.push(patternForDuration(DEFAULT_INTERVAL));
        context.markDirty();
      }}
    ></ha-switch>`,
    true,
  )}
  ${renderFormField(
    context.localize("editor.common.duration"),
    html`<ha-notifications-duration-input
      .hass=${context.hass}
      .value=${intervalValue(trigger)}
      .label=${context.localize("editor.common.duration")}
      aria-label=${context.localize("editor.common.duration")}
      @nc-duration-change=${(event: CustomEvent<{ value: string }>) => {
        context.value.triggers = context.value.triggers.filter(
          (item) => item.trigger !== "time_pattern",
        );
        context.value.triggers.push(
          patternForDuration(durationInputValue(event.detail.value, DEFAULT_INTERVAL)),
        );
        context.markDirty();
      }}
    ></ha-notifications-duration-input>`,
    true,
  )}
  <div class="nc-help">${context.localize("editor.triggers.interval_help")}</div>`;
}

export function renderCustomTriggersSection(
  context: EditorSectionContext<"setEditorElement" | "setEditorControl">,
): TemplateResult {
  return renderEditorSection(
    context.localize("editor.triggers.custom"),
    html`<div ${ref((element) => element && context.setEditorElement("triggers-yaml", element as HTMLElement))} data-role="triggers-yaml">
      ${renderFormField(
        context.localize("editor.triggers.yaml"),
        codeEditor({
          role: "triggers-yaml-editor",
          value: triggerYaml(customTriggers(context.value.triggers || [])),
          placeholder: `- trigger: state\n  entity_id: binary_sensor.example\n  to: "on"`,
          mode: "yaml",
          language: "yaml",
          label: context.localize("editor.triggers.yaml"),
          onInput: () => context.markDirty(),
          onReady: (editor) => context.setEditorControl("triggers-yaml", editor),
        }),
        true,
      )}
      <div class="nc-help">${context.localize("editor.triggers.help")}</div>
    </div>`,
    "",
    context.activeSection === "Triggers",
  );
}
