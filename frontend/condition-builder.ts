import { html, render } from "lit";
import type { AlertCondition, Registries } from "./types.js";
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
  registries: Registries,
  conditions: AlertCondition[] = [],
  markDirty: () => void,
): () => AlertCondition[] {
  const state: AlertCondition[] = conditions
    .filter((condition) =>
      conditionTypes.some(([type]) => type === condition.type),
    )
    .map((condition) => ({ ...condition }));

  const entities = registries.entities.filter(
    (item) => !item.entity_id.startsWith("notify."),
  );
  const entityListId = `nc-condition-entities-${Math.random().toString(36).slice(2)}`;

  const entityName = (entityId: string): string => {
    const entity = entities.find((item) => item.entity_id === entityId);
    return (
      entity?.friendly_name ||
      entity?.name_by_user ||
      entity?.name ||
      entity?.original_name ||
      entityId
    );
  };

  const entityLabel = (entityId: string): string => {
    const name = entityName(entityId);
    if (name === entityId) return entityId;
    return `${name} (${entityId})`;
  };

  const resolveEntityInput = (input: string): string => {
    const value = input.trim();
    const matchingEntity = entities.find((item) => item.entity_id === value);
    if (matchingEntity) return matchingEntity.entity_id;

    const matchingLabel = entities.find(
      (item) => entityLabel(item.entity_id) === value,
    );
    if (matchingLabel) return matchingLabel.entity_id;

    const matchingName = entities.filter(
      (item) => entityName(item.entity_id) === value,
    );
    if (matchingName.length === 1) return matchingName[0].entity_id;

    const entityIdMatch = value.match(/\(([^)]+)\)$/);
    if (entityIdMatch?.[1]) return entityIdMatch[1];

    return value;
  };

  const update = (
    condition: AlertCondition,
    key: keyof AlertCondition,
    event: Event,
  ): void => {
    const control = event.currentTarget as HTMLInputElement | HTMLSelectElement;
    condition[key] = control.value;
    markDirty();
  };

  const updateEntity = (condition: AlertCondition, event: Event): void => {
    condition.entity_id = resolveEntityInput(
      (event.currentTarget as HTMLInputElement).value,
    );
    markDirty();
  };

  const renderBuilder = (): void => {
    render(
      html`<div class="nc-condition-rows">${conditionRowsTemplate()}</div>
        <datalist id=${entityListId}>
          ${entities.map(
            (item) =>
              html`<option value=${entityLabel(item.entity_id)}></option>`,
          )}
        </datalist>
        <button
          class="nc-button secondary"
          @click=${() => {
            state.push({ type: "state", entity_id: "", state: "on" });
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
      <label class="nc-field"
        >Type
        <select
          @change=${(event: Event) => {
            condition.type = (event.currentTarget as HTMLSelectElement)
              .value as AlertCondition["type"];
            markDirty();
            renderBuilder();
          }}
        >
          ${conditionTypes.map(
            ([value, label]) =>
              html`<option value=${value} .selected=${condition.type === value}>
                ${label}
              </option>`,
          )}
        </select>
      </label>
      <label class="nc-field"
        >Entity
        <input
          list=${entityListId}
          placeholder="Search entity name or ID"
          .value=${entityLabel(firstValue(condition.entity_id))}
          @input=${(event: Event) => updateEntity(condition, event)}
          @change=${(event: Event) => updateEntity(condition, event)}
        />
      </label>
      ${stateConditionTemplate(condition)}${numericConditionTemplate(
        condition,
      )}${attributeConditionTemplate(condition)}
      <label class="nc-field"
        >For${durationInput(
          durationInputValue(condition.for, "00:00:00"),
          (next) => {
            condition.for = next;
            markDirty();
          },
        )}</label
      >
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
    </div>`;

  const stateConditionTemplate = (condition: AlertCondition) => {
    if (condition.type !== "state") {
      return "";
    }

    return html`<label class="nc-field"
      >State<input
        value=${firstValue(condition.state)}
        @input=${(event: Event) => update(condition, "state", event)}
    /></label>`;
  };

  const numericConditionTemplate = (condition: AlertCondition) => {
    if (condition.type !== "numeric") {
      return "";
    }

    return html`<label class="nc-field"
        >Above<input
          type="number"
          .value=${String(condition.above ?? "")}
          @input=${(event: Event) =>
            update(condition, "above", event)} /></label
      ><label class="nc-field"
        >Below<input
          type="number"
          .value=${String(condition.below ?? "")}
          @input=${(event: Event) => update(condition, "below", event)}
      /></label>`;
  };

  const attributeConditionTemplate = (condition: AlertCondition) => {
    if (condition.type !== "attribute") {
      return "";
    }

    return html`<label class="nc-field"
        >Attribute<input
          .value=${condition.attribute || ""}
          @input=${(event: Event) =>
            update(condition, "attribute", event)} /></label
      ><label class="nc-field"
        >Expected value<input
          .value=${condition.value || ""}
          @input=${(event: Event) => update(condition, "value", event)}
      /></label>`;
  };

  renderBuilder();
  return () =>
    state.filter((condition) => Boolean(firstValue(condition.entity_id)));
}
