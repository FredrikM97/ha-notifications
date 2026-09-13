import { actionButton } from "./dom.ts";

export function createRecipientPicker(
  registries,
  target,
  markDirty,
) {
  const typeLabels = {
    device_id: "Devices",
    area_id: "Areas",
    floor_id: "Floors",
    label_id: "Labels",
    entity_id: "Notification entities",
  };

  const items = [
    ...(registries.devices || []).map(
      (item) => ({
        type: "device_id",
        id: item.id,
        label:
          item.name_by_user ||
          item.name ||
          item.id,
      }),
    ),
    ...(registries.areas || []).map(
      (item) => ({
        type: "area_id",
        id: item.area_id || item.id,
        label: item.name || item.id,
      }),
    ),
    ...(registries.floors || []).map(
      (item) => ({
        type: "floor_id",
        id: item.floor_id || item.id,
        label: item.name || item.id,
      }),
    ),
    ...(registries.labels || []).map(
      (item) => ({
        type: "label_id",
        id: item.label_id || item.id,
        label: item.name || item.id,
      }),
    ),
    ...(registries.entities || [])
      .filter(
        (item) =>
          item.entity_id?.startsWith(
            "notify.",
          ),
      )
      .map(
        (item) => ({
          type: "entity_id",
          id: item.entity_id,
          label:
            item.name || item.entity_id,
        }),
      ),
  ];

  const selected = new Set<string>();

  for (const item of items) {
    if (
      (target[item.type] || []).some(
        (value) =>
          String(value) === String(item.id),
      )
    ) {
      selected.add(
        `${item.type}:${item.id}`,
      );
    }
  }

  const wrapper =
    document.createElement(
      "div",
    );

  wrapper.className =
    "nc-target-picker";

  const toolbar =
    document.createElement(
      "div",
    );

  toolbar.className =
    "nc-recipient-toolbar";

  const search =
    document.createElement(
      "input",
    );

  search.type = "search";
  search.placeholder =
    "Search devices, labels, or notification services";

  const filter =
    document.createElement(
      "div",
    );

  filter.className =
    "nc-recipient-filters";

  let selectedType = "all";

  const filterOptions = [
    ["all", "All"],
    ...Object.entries(typeLabels),
  ];

  for (const [value, label] of filterOptions) {
    const option =
      document.createElement(
        "button",
      );

    option.type = "button";
    option.className =
      "nc-recipient-filter";
    option.textContent = label;

    option.addEventListener(
      "click",
      () => {
        selectedType = value;
        isOpen = true;
        render();
      },
    );

    filter.appendChild(option);
  }

  const results =
    document.createElement(
      "div",
    );

  results.className =
    "nc-recipient-results";

  let isOpen = false;

  const selectedWrap =
    document.createElement(
      "div",
    );

  selectedWrap.className =
    "nc-target-chips";

  const selectedHeading =
    document.createElement(
      "div",
    );

  selectedHeading.className =
    "nc-target-selection-label";
  selectedHeading.textContent =
    "Selected recipients";

  const render = () => {
    selectedWrap.replaceChildren();

    for (const selectedKey of selected) {
      const [type, ...idParts] =
        selectedKey.split(":");
      const id = idParts.join(":");
      const item = items.find(
        (candidate) =>
          candidate.type === type &&
          String(candidate.id) === id,
      );

      const chip =
        document.createElement(
          "span",
        );

      chip.className =
        "nc-target-chip";
      chip.append(
        document.createTextNode(
          item?.label || id,
        ),
      );

      chip.title =
        typeLabels[type] || type;

      const remove =
        actionButton(
          "Remove",
          "nc-chip-remove",
        );

      remove.addEventListener(
        "click",
        () => {
          selected.delete(
            selectedKey,
          );
          markDirty();
          wrapper.dispatchEvent(
            new Event("change"),
          );
          render();
        },
      );

      chip.append(remove);
      selectedWrap.append(chip);
    }

    const query =
      search.value.trim().toLowerCase();
    results.replaceChildren();
    results.hidden = !isOpen;

    for (const [index, option] of Array.from(
      filter.children,
    ).entries()) {
      option.classList.toggle(
        "active",
        filterOptions[index][0] === selectedType,
      );
    }

    const matchingItems = items.filter(
      (item) =>
        !selected.has(
          `${item.type}:${item.id}`,
        ) &&
        (selectedType === "all" ||
          item.type === selectedType) &&
        (!query ||
          item.label.toLowerCase().includes(query)),
    );

    if (!matchingItems.length) {
      const empty =
        document.createElement(
          "div",
        );

      empty.className =
        "nc-recipient-empty";
      empty.textContent = query
        ? "No matching recipients"
        : "No recipients available";
      results.append(empty);
    }

    for (const item of matchingItems) {
      const option =
        document.createElement(
          "button",
        );

      option.type = "button";
      option.className =
        "nc-recipient-option";
      option.textContent = item.label;
      option.title = typeLabels[item.type];

      option.addEventListener(
        "mousedown",
        (event) => event.preventDefault(),
      );

      option.addEventListener(
        "click",
        () => {
          selected.add(
            `${item.type}:${item.id}`,
          );
          markDirty();
          wrapper.dispatchEvent(
            new Event("change"),
          );
          isOpen = false;
          render();
        },
      );

      results.append(option);
    }
  };

  search.addEventListener(
    "input",
    () => {
      isOpen = true;
      render();
    },
  );

  search.addEventListener(
    "focus",
    () => {
      isOpen = true;
      render();
    },
  );

  wrapper.addEventListener(
    "focusout",
    (event) => {
      if (
        !wrapper.contains(
          event.relatedTarget as Node | null,
        )
      ) {
        isOpen = false;
        render();
      }
    },
  );

  const inputArea =
    document.createElement(
      "div",
    );

  inputArea.className =
    "nc-recipient-input";

  toolbar.append(
    search,
    filter,
  );

  inputArea.append(
    toolbar,
    results,
  );

  wrapper.append(
    selectedHeading,
    selectedWrap,
    inputArea,
  );
  render();

  return {
    element: wrapper,
    target: () => {
      const result: Record<string, string[]> = {};

      for (const selectedKey of selected) {
        const [type, ...idParts] =
          selectedKey.split(":");

        if (!result[type]) {
          result[type] = [];
        }

        result[type].push(
          idParts.join(":"),
        );
      }

      return result;
    },
  };
}

