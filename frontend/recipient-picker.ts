import { html, LitElement, render } from "lit";
import type { NotificationTarget, Registries } from "./types.js";
import type { Hass } from "./types.js";
import { localize } from "./localize.js";

type RecipientType = keyof NotificationTarget;
type FilterType = "all" | RecipientType;
interface RecipientItem { type: RecipientType; id: string; label: string; }

class RecipientPickerElement extends LitElement {
  private hass: Hass | null = null;
  private labels: Record<FilterType, string> = {} as Record<FilterType, string>;
  private items: RecipientItem[] = [];
  private selected = new Set<string>();
  private filter: FilterType = "all";
  private search = "";
  private open = false;
  private markDirty = (): void => undefined;

  protected createRenderRoot(): HTMLElement { return this; }

  initialize(registries: Registries, target: NotificationTarget, markDirty: () => void, hass?: Hass): void {
    this.hass = hass;
    this.labels = { all: localize(hass, "common.all"), device_id: localize(hass, "common.devices"), area_id: localize(hass, "common.areas"), floor_id: localize(hass, "common.floors"), label_id: localize(hass, "common.labels"), entity_id: localize(hass, "common.notification_entities"), user_id: localize(hass, "common.users") };
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
    render(this.render(), this);
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
      <div class="nc-target-selection-label">${localize(this.hass, "editor.recipients.selected")}</div>
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

export function createRecipientPicker(registries: Registries, target: NotificationTarget, markDirty: () => void, hass?: Hass): { element: HTMLElement; target: () => NotificationTarget } {
  const element = new RecipientPickerElement();
  element.initialize(registries, target, markDirty, hass);
  element.renderImmediately();
  return { element, target: () => element.currentTarget() };
}
