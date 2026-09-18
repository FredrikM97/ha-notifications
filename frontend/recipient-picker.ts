import { html, LitElement, render } from "lit";
import type { NotificationTarget, Registries } from "./types.js";

type RecipientType = keyof NotificationTarget;
type FilterType = "all" | RecipientType;
interface RecipientItem { type: RecipientType; id: string; label: string; }

class RecipientPickerElement extends LitElement {
  private readonly labels: Record<FilterType, string> = { all: "All", device_id: "Devices", area_id: "Areas", floor_id: "Floors", label_id: "Labels", entity_id: "Notification entities", user_id: "Users" };
  private items: RecipientItem[] = [];
  private selected = new Set<string>();
  private filter: FilterType = "all";
  private search = "";
  private open = false;
  private markDirty = (): void => undefined;

  protected createRenderRoot(): HTMLElement { return this; }

  initialize(registries: Registries, target: NotificationTarget, markDirty: () => void): void {
    this.items = [
      ...registries.devices.map((item) => ({ type: "device_id" as const, id: item.id, label: item.name_by_user || item.name || item.id })),
      ...registries.areas.map((item) => ({ type: "area_id" as const, id: item.area_id || item.id || "", label: item.name || item.id || "" })),
      ...registries.floors.map((item) => ({ type: "floor_id" as const, id: item.floor_id || item.id || "", label: item.name || item.id || "" })),
      ...registries.labels.map((item) => ({ type: "label_id" as const, id: item.label_id || item.id || "", label: item.name || item.id || "" })),
      ...registries.entities.filter((item) => item.entity_id.startsWith("notify.")).map((item) => ({ type: "entity_id" as const, id: item.entity_id, label: item.name || item.entity_id })),
      ...registries.users.filter((item) => item.is_active !== false).map((item) => ({ type: "user_id" as const, id: item.id, label: item.name })),
    ];
    this.selected = new Set(this.items.filter((item) => (target[item.type] || []).some((value) => String(value) === item.id)).map((item) => `${item.type}:${item.id}`));
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
      <div class="nc-target-selection-label">Selected recipients</div>
      <div class="nc-target-chips">${selectedItems.map(({ key, type, id, item }) => html`<span class="nc-target-chip" title=${this.labels[type]}>${item?.label || id}<button class="nc-chip-remove" @click=${() => this.removeRecipient(key)}>Remove</button></span>`)}</div>
      <div class="nc-recipient-input"><div class="nc-recipient-toolbar">
        <ha-input type="search" class="nc-recipient-search" autocomplete="off" name="ha-notifications-recipient-search" placeholder="Search recipients" .value=${this.search} @input=${this.handleSearchInput} @focus=${this.openResults}></ha-input>
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
    if (!matches.length) return html`<div class="nc-recipient-empty">${query ? "No matching recipients" : "No recipients available"}</div>`;
    return matches.map((item) => html`<button class="nc-recipient-option" title=${this.labels[item.type]} @mousedown=${(event: Event) => event.preventDefault()} @click=${() => this.selectRecipient(item)}>${item.label}</button>`);
  }

  private selectRecipient(item: RecipientItem): void {
    this.selected.add(`${item.type}:${item.id}`);
    this.open = false;
    this.notifyChange();
  }
}

customElements.define("ha-notifications-recipient-picker", RecipientPickerElement);

export function createRecipientPicker(registries: Registries, target: NotificationTarget, markDirty: () => void): { element: HTMLElement; target: () => NotificationTarget } {
  const element = new RecipientPickerElement();
  element.initialize(registries, target, markDirty);
  element.renderImmediately();
  return { element, target: () => element.currentTarget() };
}
