import { css, html } from "lit";
import { ref } from "lit/directives/ref.js";
import type { TemplateResult } from "lit";
import type { EditorSectionContext } from "../editor/types.js";
import { codeEditor } from "../components/code-editor.js";
import { durationInputValue } from "../components/duration-input.js";
import { checkedValue } from "../components/form-controls.js";
import { renderFormField } from "../components/form-field.js";
import { conditionYaml } from "../editor/serialization.js";
import {
  DEFAULT_INTERVAL,
  hasStartupTrigger,
  intervalTrigger,
  intervalValue,
  patternForDuration,
} from "../editor/triggers.js";
import { renderEditorSection, renderHelpTooltip } from "../editor/section.js";

const conditionSettingsStyles = css`
  .nc-condition-setting {
    display: grid;
    gap: 16px;
  }
`;

export function renderConditionSection(
  context: EditorSectionContext<
    "hass" | "refreshStatuses" | "setEditorElement" | "setEditorControl"
  >,
): TemplateResult {
  const trigger = intervalTrigger(context.value.triggers);
  return renderEditorSection(
    context.localize("editor.conditions.section"),
    html`<div class="nc-condition-setting">
        ${renderFormField(
          context.localize("editor.conditions.startup"),
          html`<ha-switch
            .checked=${hasStartupTrigger(context.value.triggers)}
            aria-label=${context.localize("editor.conditions.startup")}
            @change=${(event: Event) => {
              const enabled = checkedValue(event);
              context.value.triggers = context.value.triggers.filter(
                (item) =>
                  !(item.trigger === "homeassistant" && item.event === "start"),
              );
              if (enabled) {
                context.value.triggers.push({
                  trigger: "homeassistant",
                  event: "start",
                });
              }
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-switch>`,
          true,
          "nc-inline-toggle",
        )}
        ${renderFormField(
          context.localize("editor.conditions.interval_enabled"),
          html`<ha-switch
            data-role="interval-toggle"
            .checked=${Boolean(trigger)}
            aria-label=${context.localize("editor.conditions.interval_enabled")}
            @change=${(event: Event) => {
              const enabled = checkedValue(event);
              context.value.triggers = context.value.triggers.filter(
                (item) => item.trigger !== "time_pattern",
              );
              if (enabled) {
                context.value.triggers.push(patternForDuration(DEFAULT_INTERVAL));
              }
              context.markDirty();
              context.refreshStatuses();
            }}
          ></ha-switch>`,
          true,
          "nc-inline-toggle",
        )}
        ${renderFormField(
          html`${context.localize("editor.conditions.interval")} ${renderHelpTooltip(
            context.localize("editor.conditions.interval_help"),
            context.localize("editor.common.more_info"),
          )}`,
          html`<ha-notifications-duration-input
            .hass=${context.hass}
            .value=${intervalValue(trigger)}
            aria-label=${context.localize("editor.conditions.interval")}
            @nc-duration-change=${(event: CustomEvent<{ value: string }>) => {
              context.value.triggers = context.value.triggers.filter(
                (item) => item.trigger !== "time_pattern",
              );
              context.value.triggers.push(
                patternForDuration(
                  durationInputValue(event.detail.value, DEFAULT_INTERVAL),
                ),
              );
              context.markDirty();
            }}
          ></ha-notifications-duration-input>`,
          true,
        )}
        <div ${ref((element) => element && context.setEditorElement("conditions-yaml", element as HTMLElement))} data-role="conditions-yaml">
          ${renderFormField(
            html`${context.localize("editor.conditions.yaml")} ${renderHelpTooltip(
              context.localize("editor.conditions.help"),
              context.localize("editor.common.more_info"),
            )}`,
            codeEditor({
              role: "conditions-yaml-editor",
              value: conditionYaml(context.value.conditions),
              hass: context.hass,
              visualType: "condition",
              placeholder: context.localize("editor.conditions.placeholder"),
              mode: "yaml",
              language: "yaml",
              label: context.localize("editor.conditions.yaml"),
              onInput: () => context.markDirty(),
              onReady: (editor) => context.setEditorControl("conditions-yaml", editor),
            }),
            true,
          )}
        </div>
      </div>
      `,
    "",
    context.activeSection === "Conditions",
    conditionSettingsStyles,
  );
}
