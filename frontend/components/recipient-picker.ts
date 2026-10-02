import { css, html, LitElement, render } from "lit";
import type { NotificationTarget, Registries } from "../types.js";
import type { Hass } from "../types.js";
import { localize } from "../localize.js";
import { renderHelpTooltip } from "../editor/section.js";

type RecipientType = keyof NotificationTarget;
type FilterType = "all" | RecipientType;
interface RecipientItem { type: RecipientType; id: string; label: string; }

export const recipientPickerStyles = css`
  :host {
    display: block;
    box-sizing: border-box;
    color: var(--primary-text-color);
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  button {
    font: inherit;
  }

  .nc-target-picker {
    display: grid;
    gap: 8px;
  }

  .nc-recipient-input {
    position: relative;
    z-index: 40;
  }

  .nc-recipient-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }

  .nc-recipient-toolbar ha-input {
    min-width: 0;
    width: 100%;
  }

  .nc-recipient-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    grid-column: 1 / -1;
  }

  .nc-recipient-filter {
    border: 1px solid var(--divider-color);
    border-radius: 999px;
    padding: 5px 9px;
    background: transparent;
    color: var(--secondary-text-color);
    cursor: pointer;
    font-size: 12px;
  }

  .nc-recipient-filter.active,
  .nc-recipient-filter:hover {
    border-color: var(--primary-color);
    background: var(--primary-color);
    color: var(--text-primary-color, white);
  }

  .nc-recipient-results {
    display: grid;
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    left: 0;
    z-index: 50;
    grid-template-columns: 1fr;
    gap: 6px;
    max-height: 240px;
    overflow: auto;
    padding: 2px;
    border: 1px solid var(--divider-color);
    border-radius: 9px;
    background: var(--card-background-color);
    box-shadow: var(--ha-box-shadow);
  }

  .nc-recipient-results[hidden] {
    display: none;
  }

  .nc-recipient-option {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--divider-color);
    border-radius: 8px;
    padding: 8px 10px;
    background: var(--primary-background-color);
    color: var(--primary-text-color);
    cursor: pointer;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nc-recipient-option:hover {
    border-color: var(--primary-color);
  }

  .nc-recipient-empty {
    grid-column: 1 / -1;
    padding: 12px;
    color: var(--secondary-text-color);
    text-align: center;
  }

  .nc-target-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 24px;
  }

  .nc-target-selection-label {
    color: var(--secondary-text-color);
    font-size: 12px;
    font-weight: 600;
  }

  .nc-target-selection-heading {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .nc-target-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 5px 7px 5px 10px;
    border-radius: 999px;
    background: var(--secondary-background-color);
    color: var(--primary-text-color);
    font-size: 13px;
  }

  .nc-chip-remove {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--secondary-text-color);
    cursor: pointer;
    font-size: 0;
  }

  .nc-chip-remove::after {
    content: "×";
    font-size: 18px;
    line-height: 1;
  }

  @container (max-width: 700px) {
    .nc-recipient-toolbar {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 700px) {
    .nc-recipient-toolbar {
      grid-template-columns: 1fr;
    }
  }
`;

class RecipientPickerElement extends LitElement {
  static styles = recipientPickerStyles;

  private hass: Hass | null = null;
  private labels: Record<FilterType, string> = {} as Record<FilterType, string>;
  private items: RecipientItem[] = [];
  private selected = new Set<string>();
  private filter: FilterType = "all";
  private search = "";
  private open = false;
  private markDirty = (): void => undefined;

  protected shouldUpdate(): boolean {
    return false;
  }

  initialize(registries: Registries, target: NotificationTarget, markDirty: () => void, hass?: Hass): void {
    this.hass = hass;
    this.updateLabels();
    this.items = [
      ...registries.devices.map((item) => ({ type: "device_id" as const, id: item.id, label: item.name_by_user || item.name || item.id })),
      ...registries.areas.map((item) => ({ type: "area_id" as const, id: item.area_id || item.id || "", label: item.name || item.id || "" })),
      ...registries.floors.map((item) => ({ type: "floor_id" as const, id: item.floor_id || item.id || "", label: item.name || item.id || "" })),
      ...registries.labels.map((item) => ({ type: "label_id" as const, id: item.label_id || item.id || "", label: item.name || item.id || "" })),
      ...registries.entities.filter((item) => item.entity_id.startsWith("notify.")).map((item) => ({ type: "entity_id" as const, id: item.entity_id, label: item.name || item.entity_id })),
      ...registries.users.filter((item) => item.is_active !== false).map((item) => ({ type: "user_id" as const, id: item.id, label: item.name })),
    ];
    this.selected = new Set(
      (Object.keys(this.labels) as RecipientType[]).flatMap((type) =>
        (target[type] || []).map((value) => `${type}:${String(value)}`),
      ),
    );
    this.markDirty = markDirty;
  }

  setHass(hass: Hass): void {
    this.hass = hass;
    this.updateLabels();
    this.rerender();
  }

  private updateLabels(): void {
    this.labels = { all: localize(this.hass, "common.all"), device_id: localize(this.hass, "common.devices"), area_id: localize(this.hass, "common.areas"), floor_id: localize(this.hass, "common.floors"), label_id: localize(this.hass, "common.labels"), entity_id: localize(this.hass, "common.notification_entities"), user_id: localize(this.hass, "common.users") };
  }

  currentTarget(): NotificationTarget {
    const result: NotificationTarget = {};
    for (const key of this.selected) {
      const [type, ...parts] = key.split(":");
      const recipientType = type as RecipientType;
      result[recipientType] ||= [];
      result[recipientType]?.push(parts.join(":"));
    }
    return result;
  }

  renderImmediately(): void {
    this.rerender();
  }

  private rerender(): void {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    render(this.render(), root);
  }

  protected render() {
    const query = this.search.trim().toLowerCase();
    const matches = this.items.filter((item) => !this.selected.has(`${item.type}:${item.id}`) && (this.filter === "all" || item.type === this.filter) && (!query || item.label.toLowerCase().includes(query)));
    const selectedItems = [...this.selected].map((key) => {
      const [type, ...parts] = key.split(":");
      const id = parts.join(":");
      return { key, type: type as RecipientType, id, item: this.items.find((candidate) => candidate.type === type && candidate.id === id) };
    });
    return html`<div class="nc-target-picker">
      <div class="nc-target-selection-heading">
        <span class="nc-target-selection-label">${localize(this.hass, "editor.recipients.selected")}</span>
        ${renderHelpTooltip(
          html`<p>${localize(this.hass, "editor.recipients.help")}</p>
            <p>${localize(this.hass, "editor.recipients.service_help")}</p>`,
          localize(this.hass, "editor.common.more_info"),
        )}
      </div>
      <div class="nc-target-chips">${selectedItems.map(({ key, type, id, item }) => html`<span class="nc-target-chip" title=${this.labels[type]}>${item?.label || id}<button class="nc-chip-remove" @click=${() => this.removeRecipient(key)}>${localize(this.hass, "common.remove")}</button></span>`)}</div>
      <div class="nc-recipient-input"><div class="nc-recipient-toolbar">
        <ha-input type="search" class="nc-recipient-search" autocomplete="off" name="ha-notifications-recipient-search" placeholder=${localize(this.hass, "editor.recipients.search")} .value=${this.search} @input=${this.handleSearchInput} @focus=${this.openResults}></ha-input>
        <div class="nc-recipient-filters">${(Object.keys(this.labels) as FilterType[]).map((key) => html`<button class=${this.recipientFilterClass(this.filter === key)} @click=${() => this.selectFilter(key)}>${this.labels[key]}</button>`)}</div>
      </div>
      <div class="nc-recipient-results" ?hidden=${!this.open} @focusout=${this.handleResultsFocusOut}>${this.recipientMatchesTemplate(matches, query)}</div></div>
    </div>`;
  }

  private removeRecipient(key: string): void {
    this.selected.delete(key);
    this.notifyChange();
  }

  private handleSearchInput = (event: Event): void => {
    this.search = (event.currentTarget as HTMLInputElement).value;
    this.openResults();
  };

  private openResults = (): void => {
    this.open = true;
    this.rerender();
  };

  private selectFilter = (filter: FilterType): void => {
    this.filter = filter;
    this.openResults();
  };

  private handleResultsFocusOut = (event: FocusEvent): void => {
    const results = event.currentTarget as HTMLElement;
    if (results.contains(event.relatedTarget as Node | null)) return;
    this.open = false;
    this.rerender();
  };

  private notifyChange(): void { this.markDirty(); this.rerender(); }
  private recipientFilterClass(active: boolean): string { return active ? "nc-recipient-filter active" : "nc-recipient-filter"; }
  private recipientMatchesTemplate(matches: RecipientItem[], query: string) {
    if (!matches.length) return html`<div class="nc-recipient-empty">${query ? localize(this.hass, "editor.recipients.no_matching") : localize(this.hass, "editor.recipients.empty")}</div>`;
    return matches.map((item) => html`<button class="nc-recipient-option" title=${this.labels[item.type]} @mousedown=${(event: Event) => event.preventDefault()} @click=${() => this.selectRecipient(item)}>${item.label}</button>`);
  }

  private selectRecipient(item: RecipientItem): void {
    this.selected.add(`${item.type}:${item.id}`);
    this.open = false;
    this.notifyChange();
  }
}

customElements.define("ha-notifications-recipient-picker", RecipientPickerElement);

export function createRecipientPicker(registries: Registries, target: NotificationTarget, markDirty: () => void, hass?: Hass): { element: HTMLElement; target: () => NotificationTarget; setHass: (hass: Hass) => void } {
  const element = new RecipientPickerElement();
  element.initialize(registries, target, markDirty, hass);
  element.renderImmediately();
  return {
    element,
    target: () => element.currentTarget(),
    setHass: (nextHass) => element.setHass(nextHass),
  };
}
