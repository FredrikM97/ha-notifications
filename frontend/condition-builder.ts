import { html, render } from "lit";
import type { AlertCondition, Hass, Registries } from "./types.js";
import { durationInput, durationInputValue } from "./editor/helpers.js";

const conditionTypes = [
  ["state", "State"],
  ["numeric", "Numeric state"],
  ["attribute", "Attribute"],
] as const;

function firstValue(
  value: string | string[] | Record<string, number> | undefined,
): string {
  if (Array.isArray(value)) return value[0] || "";
  if (typeof value === "string") return value;
  return "";
}

export function visualConditionBuilder(
  container: HTMLElement,
  hass: Hass,
  registries: Registries,
  conditions: AlertCondition[] = [],
  markDirty: () => void,
): () => AlertCondition[] {
  const state: AlertCondition[] = conditions
    .filter((condition) =>
      conditionTypes.some(([type]) => type === condition.type),
    )
    .map((condition) => ({ ...condition }));
  const expandedIds = new Set(
    state.filter((condition) => Boolean(condition.id)),
  );

  const entities = registries.entities.filter(
    (item) => !item.entity_id.startsWith("notify."),
  );

  const update = (
    condition: AlertCondition,
    key: keyof AlertCondition,
    event: Event,
  ): void => {
    const control = event.currentTarget as HTMLInputElement | HTMLSelectElement;
    condition[key] = control.value;
    markDirty();
  };

  const updateEntity = (
    condition: AlertCondition,
    event: CustomEvent<{ value?: string | string[] }>,
  ): void => {
    const selected = event.detail.value;
    condition.entity_id = Array.isArray(selected)
      ? selected[0] || ""
      : selected || "";
    markDirty();
  };

  const renderBuilder = (): void => {
    render(
      html`<div class="nc-condition-rows">${conditionRowsTemplate()}</div>
        <div class="nc-help">
          IDs are optional. Set one such as <code>front_door</code> to use its
          result in a notification with
          <code>condition.front_door</code>.
        </div>
        <button
          class="nc-button secondary"
          @click=${() => {
            state.push({
              type: "state",
              entity_id: "",
              state: "on",
            });
            markDirty();
            renderBuilder();
          }}
        >
          Add condition
        </button>`,
      container,
    );
  };

  const conditionRowsTemplate = () => {
    if (!state.length) {
      return html`<div class="nc-help">No visual conditions configured.</div>`;
    }

    return state.map((condition, index) =>
      conditionRowTemplate(condition, index),
    );
  };

  const conditionRowTemplate = (condition: AlertCondition, index: number) =>
    html` <div class="nc-condition-row">
      ${condition.id || expandedIds.has(condition)
        ? html`<label class="nc-field"
            >ID (optional)<ha-input
              type="text"
              .value=${condition.id || ""}
              placeholder="front_door"
              @input=${(event: Event) => update(condition, "id", event)}
            ></ha-input
          ></label>`
        : html``}
      <label class="nc-field"
        >Type
        <ha-selector
          .hass=${hass}
          .selector=${{
            select: {
              mode: "dropdown",
              options: conditionTypes.map(([value, label]) => ({
                value,
                label,
              })),
            },
          }}
          .value=${condition.type}
          @value-changed=${(event: CustomEvent<{ value?: string }>) => {
            condition.type = (event.detail.value ||
              "state") as AlertCondition["type"];
            markDirty();
            renderBuilder();
          }}
        ></ha-selector>
      </label>
      <label class="nc-field"
        >Entity
        <ha-selector
          .hass=${hass}
          .selector=${{
            entity: {
              include_entities: entities.map((item) => item.entity_id),
            },
          }}
          .value=${firstValue(condition.entity_id)}
          @value-changed=${(
            event: CustomEvent<{ value?: string | string[] }>,
          ) => updateEntity(condition, event)}
        ></ha-selector>
      </label>
      ${stateConditionTemplate(condition)}${numericConditionTemplate(
        condition,
      )}${attributeConditionTemplate(condition)}
      <label class="nc-field nc-condition-duration"
        >For${durationInput(
          durationInputValue(condition.for, "00:00:00"),
          (next) => {
            condition.for = next;
            markDirty();
          },
          hass,
        )}</label
      >
      <div class="nc-condition-actions">
        ${condition.id || expandedIds.has(condition)
          ? html``
          : html`<button
              class="nc-button secondary nc-condition-id-toggle"
              type="button"
              @click=${() => {
                expandedIds.add(condition);
                renderBuilder();
              }}
            >
              <ha-icon icon="mdi:tag-plus-outline"></ha-icon>
              Add ID
            </button>`}
        <button
          class="nc-button danger"
          @click=${() => {
            state.splice(index, 1);
            markDirty();
            renderBuilder();
          }}
        >
          Remove condition
        </button>
      </div>
    </div>`;

  const stateConditionTemplate = (condition: AlertCondition) => {
    if (condition.type !== "state") {
      return "";
    }

    return html`<label class="nc-field"
      >State<ha-input
        type="text"
        value=${firstValue(condition.state)}
        @input=${(event: Event) => update(condition, "state", event)}
      ></ha-input
    ></label>`;
  };

  const numericConditionTemplate = (condition: AlertCondition) => {
    if (condition.type !== "numeric") {
      return "";
    }

    return html`<label class="nc-field"
        >Above<ha-input
          type="number"
          .value=${String(condition.above ?? "")}
          @input=${(event: Event) => update(condition, "above", event)}
        ></ha-input></label
      ><label class="nc-field"
        >Below<ha-input
          type="number"
          .value=${String(condition.below ?? "")}
          @input=${(event: Event) => update(condition, "below", event)}
        ></ha-input
      ></label>`;
  };

  const attributeConditionTemplate = (condition: AlertCondition) => {
    if (condition.type !== "attribute") {
      return "";
    }

    return html`<label class="nc-field"
        >Attribute<ha-input
          type="text"
          .value=${condition.attribute || ""}
          @input=${(event: Event) => update(condition, "attribute", event)}
        ></ha-input></label
      ><label class="nc-field"
        >Expected value<ha-input
          type="text"
          .value=${condition.value || ""}
          @input=${(event: Event) => update(condition, "value", event)}
        ></ha-input
      ></label>`;
  };

  renderBuilder();
  return () =>
    state.filter((condition) => Boolean(firstValue(condition.entity_id)));
}
