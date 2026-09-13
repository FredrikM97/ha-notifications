import { html, render } from "lit";
import type { NotificationTarget, Registries } from "./types.js";

type RecipientType = keyof NotificationTarget;
type FilterType = "all" | RecipientType;

interface RecipientItem {
  type: RecipientType;
  id: string;
  label: string;
}

export function createRecipientPicker(
  registries: Registries,
  target: NotificationTarget,
  markDirty: () => void,
) {
  const host = document.createElement("div");
  const labels: Record<FilterType, string> = {
    all: "All",
    device_id: "Devices",
    area_id: "Areas",
    floor_id: "Floors",
    label_id: "Labels",
    entity_id: "Notification entities",
    user_id: "Users",
  };
  const items: RecipientItem[] = [
    ...registries.devices.map((item) => ({
      type: "device_id" as const,
      id: item.id,
      label: item.name_by_user || item.name || item.id,
    })),
    ...registries.areas.map((item) => ({
      type: "area_id" as const,
      id: item.area_id || item.id || "",
      label: item.name || item.id || "",
    })),
    ...registries.floors.map((item) => ({
      type: "floor_id" as const,
      id: item.floor_id || item.id || "",
      label: item.name || item.id || "",
    })),
    ...registries.labels.map((item) => ({
      type: "label_id" as const,
      id: item.label_id || item.id || "",
      label: item.name || item.id || "",
    })),
    ...registries.entities
      .filter((item) => item.entity_id.startsWith("notify."))
      .map((item) => ({
        type: "entity_id" as const,
        id: item.entity_id,
        label: item.name || item.entity_id,
      })),
    ...registries.users
      .filter((item) => item.is_active !== false)
      .map((item) => ({
        type: "user_id" as const,
        id: item.id,
        label: item.name,
      })),
  ];
  const selected = new Set<string>();
  for (const item of items) {
    if ((target[item.type] || []).some((value) => String(value) === item.id))
      selected.add(`${item.type}:${item.id}`);
  }
  let filter: FilterType = "all";
  let search = "";
  let open = false;

  const notifyChange = (): void => {
    markDirty();
    host.dispatchEvent(new Event("change"));
  };

  const renderPicker = (): void => {
    const query = search.trim().toLowerCase();
    const matches = items.filter(
      (item) =>
        !selected.has(`${item.type}:${item.id}`) &&
        (filter === "all" || item.type === filter) &&
        (!query || item.label.toLowerCase().includes(query)),
    );
    const selectedItems = [...selected].map((key) => {
      const [type, ...parts] = key.split(":");
      return {
        key,
        type: type as RecipientType,
        id: parts.join(":"),
        item: items.find(
          (candidate) =>
            candidate.type === type && candidate.id === parts.join(":"),
        ),
      };
    });

    render(
      html`<div class="nc-target-picker">
        <div class="nc-target-selection-label">Selected recipients</div>
        <div class="nc-target-chips">
          ${selectedItems.map(
            ({ key, type, id, item }) =>
              html`<span class="nc-target-chip" title=${labels[type]}
                >${item?.label || id}<button
                  class="nc-chip-remove"
                  @click=${() => {
                    selected.delete(key);
                    notifyChange();
                    renderPicker();
                  }}
                >
                  Remove
                </button></span
              >`,
          )}
        </div>
        <div class="nc-recipient-input">
          <div class="nc-recipient-toolbar">
            <input
              type="search"
              autocomplete="off"
              name="notification-center-recipient-search"
              placeholder="Search recipients"
              .value=${search}
              @input=${(event: Event) => {
                search = (event.currentTarget as HTMLInputElement).value;
                open = true;
                renderPicker();
              }}
              @focus=${() => {
                open = true;
                renderPicker();
              }}
            />
            <div class="nc-recipient-filters">
              ${(Object.keys(labels) as FilterType[]).map(
                (key) =>
                  html`<button
                    class="nc-recipient-filter ${filter === key
                      ? "active"
                      : ""}"
                    @click=${() => {
                      filter = key;
                      open = true;
                      renderPicker();
                    }}
                  >
                    ${labels[key]}
                  </button>`,
              )}
            </div>
          </div>
          <div
            class="nc-recipient-results"
            ?hidden=${!open}
            @focusout=${(event: FocusEvent) => {
              if (
                !(event.currentTarget as HTMLElement).contains(
                  event.relatedTarget as Node | null,
                )
              ) {
                open = false;
                renderPicker();
              }
            }}
          >
            ${matches.length
              ? matches.map(
                  (item) =>
                    html`<button
                      class="nc-recipient-option"
                      title=${labels[item.type]}
                      @mousedown=${(event: Event) => event.preventDefault()}
                      @click=${() => {
                        selected.add(`${item.type}:${item.id}`);
                        notifyChange();
                        open = false;
                        renderPicker();
                      }}
                    >
                      ${item.label}
                    </button>`,
                )
              : html`<div class="nc-recipient-empty">
                  ${query
                    ? "No matching recipients"
                    : "No recipients available"}
                </div>`}
          </div>
        </div>
      </div>`,
      host,
    );
  };

  renderPicker();
  return {
    element: host,
    target: (): NotificationTarget => {
      const result: NotificationTarget = {};
      for (const key of selected) {
        const [type, ...parts] = key.split(":");
        const recipientType = type as RecipientType;
        result[recipientType] ||= [];
        result[recipientType]?.push(parts.join(":"));
      }
      return result;
    },
  };
}
