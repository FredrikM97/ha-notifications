import { html, render } from "lit";
import type { AlertCondition, Registries } from "./types.js";

const conditionTypes = [
  ["state", "State"],
  ["numeric", "Numeric state"],
  ["attribute", "Attribute"],
] as const;

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

  if (!state.length) state.push({ type: "state", entity_id: "", state: "on" });

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

  const renderBuilder = (): void => {
    render(
      html`<div class="nc-condition-rows">
          ${state.map(
            (condition, index) =>
              html`<div class="nc-condition-row">
                <label class="nc-field"
                  >Type
                  <select
                    @change=${(event: Event) => {
                      condition.type = (
                        event.currentTarget as HTMLSelectElement
                      ).value as AlertCondition["type"];
                      markDirty();
                      renderBuilder();
                    }}
                  >
                    ${conditionTypes.map(
                      ([value, label]) =>
                        html`<option
                          value=${value}
                          .selected=${condition.type === value}
                        >
                          ${label}
                        </option>`,
                    )}
                  </select>
                </label>
                <label class="nc-field"
                  >Entity
                  <select
                    @change=${(event: Event) =>
                      update(condition, "entity_id", event)}
                  >
                    <option value="">Choose an entity</option>
                    ${entities.map(
                      (item) =>
                        html`<option
                          value=${item.entity_id}
                          .selected=${condition.entity_id === item.entity_id}
                        >
                          ${item.name || item.entity_id}
                        </option>`,
                    )}
                  </select>
                </label>
                ${condition.type === "state"
                  ? html`<label class="nc-field"
                      >State<input
                        value=${condition.state || ""}
                        @input=${(event: Event) =>
                          update(condition, "state", event)}
                    /></label>`
                  : ""}
                ${condition.type === "numeric"
                  ? html`<label class="nc-field"
                        >Above<input
                          type="number"
                          .value=${String(condition.above ?? "")}
                          @input=${(event: Event) =>
                            update(condition, "above", event)} /></label
                      ><label class="nc-field"
                        >Below<input
                          type="number"
                          .value=${String(condition.below ?? "")}
                          @input=${(event: Event) =>
                            update(condition, "below", event)}
                      /></label>`
                  : ""}
                ${condition.type === "attribute"
                  ? html`<label class="nc-field"
                        >Attribute<input
                          .value=${condition.attribute || ""}
                          @input=${(event: Event) =>
                            update(condition, "attribute", event)} /></label
                      ><label class="nc-field"
                        >Expected value<input
                          .value=${condition.value || ""}
                          @input=${(event: Event) =>
                            update(condition, "value", event)}
                      /></label>`
                  : ""}
                <label class="nc-field"
                  >For<input
                    type="time"
                    .value=${condition.for || ""}
                    @input=${(event: Event) => update(condition, "for", event)}
                /></label>
                <button
                  class="nc-button danger"
                  ?disabled=${state.length === 1}
                  @click=${() => {
                    state.splice(index, 1);
                    markDirty();
                    renderBuilder();
                  }}
                >
                  Remove condition
                </button>
              </div>`,
          )}
        </div>
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

  renderBuilder();
  return () => state.filter((condition) => Boolean(condition.entity_id));
}
