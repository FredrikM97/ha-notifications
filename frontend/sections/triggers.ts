import { css, html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import type { EditorSectionContext } from "../editor/types.js";
import type { AutomationMode } from "../types.js";
import { codeEditor } from "../components/code-editor.js";
import { checkedValue } from "../components/form-controls.js";
import { renderFormField } from "../components/form-field.js";
import { customTriggers } from "../editor/triggers.js";
import { triggerYaml } from "../editor/serialization.js";
import { renderEditorSection, renderHelpTooltip } from "../editor/section.js";

let automationModeSelectorConfigCache:
  { key: string; config: Record<string, unknown> } | undefined;

function automationModeSelectorConfig(
  options: { value: string; label: string }[],
): Record<string, unknown> {
  const key = JSON.stringify(options);
  if (automationModeSelectorConfigCache?.key === key)
    return automationModeSelectorConfigCache.config;
  const config = { select: { mode: "dropdown", options } };
  automationModeSelectorConfigCache = { key, config };
  return config;
}

const triggerSectionStyles = css`
  .nc-trigger-setting {
    display: grid;
    gap: 16px;
  }
`;

export function renderTriggerSection(
  context: EditorSectionContext<"hass">,
): TemplateResult {
  return renderEditorSection(
    context.localize("editor.triggers.section"),
    html`<div class="nc-trigger-setting">
      ${renderFormField(
        html`${context.localize("editor.triggers.cancel_on_inactive")}
        ${renderHelpTooltip(
          context.localize("editor.triggers.cancel_on_inactive_help"),
          context.localize("editor.common.more_info"),
        )}`,
        html`<ha-switch
          .checked=${context.value.cancel_on_inactive === true}
          aria-label=${context.localize("editor.triggers.cancel_on_inactive")}
          @change=${(event: Event) => {
            context.value.cancel_on_inactive = checkedValue(event);
            context.markDirty();
          }}
        ></ha-switch>`,
        true,
        "nc-inline-toggle",
      )}
      ${automationModeField(context)}
    </div>`,
    "",
    context.activeSection === "When to run",
    triggerSectionStyles,
  );
}

function automationModeField(
  context: EditorSectionContext<"hass">,
): TemplateResult {
  const hasConditions = context.value.conditions.length > 0;
  return renderFormField(
    html`${context.localize("editor.basic.automation_mode")}
    ${renderHelpTooltip(
      context.localize(
        hasConditions
          ? "editor.basic.automation_mode_condition_help"
          : "editor.basic.automation_mode_help",
      ),
      context.localize("editor.common.more_info"),
    )}`,
    html`<ha-selector
      data-role="automation-mode"
      .hass=${context.hass}
      .selector=${automationModeSelectorConfig([
        {
          value: "single",
          label: context.localize("editor.basic.mode_single"),
        },
        {
          value: "restart",
          label: context.localize("editor.basic.mode_restart"),
        },
        {
          value: "queued",
          label: context.localize("editor.basic.mode_queued"),
        },
        {
          value: "parallel",
          label: context.localize("editor.basic.mode_parallel"),
        },
      ])}
      .disabled=${hasConditions}
      .value=${hasConditions ? "parallel" : context.value.automation_mode || "parallel"}
      aria-label=${context.localize("editor.basic.automation_mode")}
      @value-changed=${(event: CustomEvent<{ value?: AutomationMode }>) => {
        if (hasConditions) return;
        context.value.automation_mode = event.detail.value || "parallel";
        context.markDirty();
      }}
    ></ha-selector>`,
  );
}

export function renderCustomTriggersSection(
  context: EditorSectionContext<
    "hass" | "refreshStatuses" | "setEditorElement" | "setEditorControl"
  >,
): TemplateResult {
  return renderEditorSection(
    context.localize("editor.triggers.custom"),
    html`<div
      class="nc-trigger-setting"
      ${ref((element) => element && context.setEditorElement("triggers-yaml", element as HTMLElement))}
      data-role="triggers-yaml"
    >
      ${renderFormField(
        html`${context.localize("editor.triggers.on_condition_change")}
        ${renderHelpTooltip(
          context.localize("editor.triggers.on_condition_change_help"),
          context.localize("editor.common.more_info"),
        )}`,
        html`<ha-switch
          .checked=${context.value.on_condition_change === true}
          aria-label=${context.localize("editor.triggers.on_condition_change")}
          @change=${(event: Event) => {
            context.value.on_condition_change = checkedValue(event);
            context.markDirty();
            context.refreshStatuses();
          }}
        ></ha-switch>`,
        true,
        "nc-inline-toggle",
      )}
      ${renderFormField(
        html`${context.localize("editor.triggers.yaml")}
        ${renderHelpTooltip(
          context.localize("editor.triggers.help"),
          context.localize("editor.common.more_info"),
        )}`,
        codeEditor({
          role: "triggers-yaml-editor",
          value: triggerYaml(customTriggers(context.value.triggers || [])),
          hass: context.hass,
          visualType: "trigger",
          placeholder: `- trigger: state\n  entity_id: binary_sensor.example\n  to: "on"`,
          mode: "yaml",
          language: "yaml",
          label: context.localize("editor.triggers.yaml"),
          onInput: () => context.markDirty(),
          onReady: (editor) =>
            context.setEditorControl("triggers-yaml", editor),
        }),
        true,
      )}
    </div>`,
    "",
    context.activeSection === "Triggers",
    triggerSectionStyles,
  );
}
