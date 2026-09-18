import { html, LitElement, render } from "lit";
import type { AlertCondition, Hass, Registries } from "./types.js";
import { durationInput, durationInputValue } from "./editor/helpers.js";

const conditionTypes = [
  ["state", "State"],
  ["numeric", "Numeric state"],
  ["attribute", "Attribute"],
] as const;

function firstValue(value: string | string[] | Record<string, number> | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  if (typeof value === "string") return value;
  return "";
}

class ConditionBuilderElement extends LitElement {
  hass!: Hass;
  private entities: Registries["entities"] = [];
  private conditions: AlertCondition[] = [];
  private markDirty = (): void => undefined;
  private expandedIds = new Set<AlertCondition>();

  protected createRenderRoot(): HTMLElement { return this; }

  initialize(hass: Hass, registries: Registries, conditions: AlertCondition[], markDirty: () => void): void {
    this.hass = hass;
    this.entities = registries.entities.filter((item) => !item.entity_id.startsWith("notify."));
    this.conditions = conditions.filter((condition) => conditionTypes.some(([type]) => type === condition.type)).map((condition) => ({ ...condition }));
    this.markDirty = markDirty;
    this.expandedIds = new Set(this.conditions.filter((condition) => Boolean(condition.id)));
  }

  currentConditions(): AlertCondition[] {
    return this.conditions.filter((condition) => Boolean(firstValue(condition.entity_id)));
  }

  renderImmediately(): void {
    this.rerender();
  }

  private rerender(): void {
    render(this.render(), this);
  }

  protected render() {
    return html`<div class="nc-condition-rows">${this.conditionRowsTemplate()}</div>
      <div class="nc-help">IDs are optional. Set one such as <code>front_door</code> to use its result in a notification with <code>condition.front_door</code>.</div>
      <button class="nc-button secondary" @click=${this.addCondition}>Add condition</button>`;
  }

  private updateField(condition: AlertCondition, key: keyof AlertCondition, event: Event): void {
    const control = event.currentTarget as HTMLInputElement | HTMLSelectElement;
    condition[key] = control.value;
    this.markDirty();
  }

  private updateEntity = (condition: AlertCondition, event: CustomEvent<{ value?: string | string[] }>): void => {
    const selected = event.detail.value;
    condition.entity_id = Array.isArray(selected) ? selected[0] || "" : selected || "";
    this.markDirty();
  };

  private addCondition = (): void => {
    this.conditions.push({ type: "state", entity_id: "", state: "on" });
    this.markDirty();
    this.rerender();
  };

  private conditionRowsTemplate() {
    if (!this.conditions.length) return html`<div class="nc-help">No visual conditions configured.</div>`;
    return this.conditions.map((condition, index) => this.conditionRowTemplate(condition, index));
  }

  private conditionRowTemplate = (condition: AlertCondition, index: number) => html`<div class="nc-condition-row">
    ${this.conditionIdTemplate(condition)}
    <label class="nc-field">Type<ha-selector .hass=${this.hass} .selector=${{ select: { mode: "dropdown", options: conditionTypes.map(([value, label]) => ({ value, label })) } }} .value=${condition.type} @value-changed=${(event: CustomEvent<{ value?: string }>) => this.updateType(condition, event)}></ha-selector></label>
    <label class="nc-field">Entity<ha-selector .hass=${this.hass} .selector=${{ entity: { include_entities: this.entities.map((item) => item.entity_id) } }} .value=${firstValue(condition.entity_id)} @value-changed=${(event: CustomEvent<{ value?: string | string[] }>) => this.updateEntity(condition, event)}></ha-selector></label>
    ${this.conditionTypeTemplate(condition)}
    <label class="nc-field nc-condition-duration">For${durationInput(durationInputValue(condition.for, "00:00:00"), (next) => { condition.for = next; this.markDirty(); }, this.hass)}</label>
    <div class="nc-condition-actions">${this.addIdButtonTemplate(condition)}
      <button class="nc-button danger" @click=${() => this.removeCondition(index)}>Remove condition</button>
    </div>
  </div>`;

  private conditionIdTemplate(condition: AlertCondition) {
    if (!condition.id && !this.expandedIds.has(condition)) return "";
    return html`<label class="nc-field">ID (optional)<ha-input type="text" .value=${condition.id || ""} placeholder="front_door" @input=${(event: Event) => this.updateField(condition, "id", event)}></ha-input></label>`;
  }

  private addIdButtonTemplate(condition: AlertCondition) {
    if (condition.id || this.expandedIds.has(condition)) return "";
    return html`<button class="nc-button secondary nc-condition-id-toggle" type="button" @click=${() => this.expandId(condition)}><ha-icon icon="mdi:tag-plus-outline"></ha-icon>Add ID</button>`;
  }

  private updateType(
    condition: AlertCondition,
    event: CustomEvent<{ value?: string }>,
  ): void {
    condition.type = (event.detail.value || "state") as AlertCondition["type"];
    this.markDirty();
    this.rerender();
  }

  private expandId(condition: AlertCondition): void {
    this.expandedIds.add(condition);
    this.rerender();
  }

  private removeCondition(index: number): void {
    this.conditions.splice(index, 1);
    this.markDirty();
    this.rerender();
  }

  private conditionTypeTemplate(condition: AlertCondition) {
    if (condition.type === "state") {
      return html`<label class="nc-field">State<ha-input type="text" .value=${firstValue(condition.state)} @input=${(event: Event) => this.updateField(condition, "state", event)}></ha-input></label>`;
    }
    if (condition.type === "numeric") {
      return html`<label class="nc-field">Above<ha-input type="number" .value=${String(condition.above ?? "")} @input=${(event: Event) => this.updateField(condition, "above", event)}></ha-input></label><label class="nc-field">Below<ha-input type="number" .value=${String(condition.below ?? "")} @input=${(event: Event) => this.updateField(condition, "below", event)}></ha-input></label>`;
    }
    if (condition.type === "attribute") {
      return html`<label class="nc-field">Attribute<ha-input type="text" .value=${condition.attribute || ""} @input=${(event: Event) => this.updateField(condition, "attribute", event)}></ha-input></label><label class="nc-field">Expected value<ha-input type="text" .value=${condition.value || ""} @input=${(event: Event) => this.updateField(condition, "value", event)}></ha-input></label>`;
    }
    return "";
  }
}

customElements.define("ha-notifications-condition-builder", ConditionBuilderElement);

export function visualConditionBuilder(container: HTMLElement, hass: Hass, registries: Registries, conditions: AlertCondition[] = [], markDirty: () => void): () => AlertCondition[] {
  const element = new ConditionBuilderElement();
  element.initialize(hass, registries, conditions, markDirty);
  render(html`${element}`, container);
  element.renderImmediately();
  return () => element.currentConditions();
}
