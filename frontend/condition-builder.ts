import { actionButton, createField, input } from "./dom";

export function visualConditionBuilder(
  container,
  registries,
  conditions,
  markDirty,
) {
  const supported = new Set([
    "state",
    "numeric",
    "attribute",
  ]);

  const state = (conditions || [])
    .filter(
      (condition) =>
        supported.has(condition.type),
    )
    .map(
      (condition) => ({
        ...condition,
      }),
    );

  if (!state.length) {
    state.push({
      type: "state",
      entity_id: "",
      state: "on",
    });
  }

  const entities = (
    registries.entities || []
  ).filter(
    (item) =>
      !item.entity_id?.startsWith(
        "notify.",
      ),
  );

  const rows =
    document.createElement(
      "div",
    );

  rows.className =
    "nc-condition-rows";

  const render = () => {
    rows.replaceChildren();

    state.forEach(
      (condition, index) => {
        const row =
          document.createElement(
            "div",
          );

        row.className =
          "nc-condition-row";

        const type =
          document.createElement(
            "select",
          );

        for (const [value, label] of [
          ["state", "State"],
          ["numeric", "Numeric state"],
          ["attribute", "Attribute"],
        ]) {
          const option =
            document.createElement(
              "option",
            );
          option.value = value;
          option.textContent = label;
          option.selected =
            condition.type === value;
          type.append(option);
        }

        const entity =
          document.createElement(
            "select",
          );

        const empty =
          document.createElement(
            "option",
          );
        empty.value = "";
        empty.textContent =
          "Choose an entity";
        entity.append(empty);

        for (const item of entities) {
          const option =
            document.createElement(
              "option",
            );
          option.value = item.entity_id;
          option.textContent =
            item.name || item.entity_id;
          option.selected =
            condition.entity_id ===
            item.entity_id;
          entity.append(option);
        }

        const stateInput = input(
          "text",
          condition.state || "",
          "on",
        );
        const aboveInput = input(
          "number",
          condition.above ?? "",
          "Above",
        );
        const belowInput = input(
          "number",
          condition.below ?? "",
          "Below",
        );
        const attributeInput = input(
          "text",
          condition.attribute || "",
          "Attribute name",
        );
        const valueInput = input(
          "text",
          condition.value ?? "",
          "Expected value",
        );
        const forInput = input(
          "time",
          condition.for || "",
          "For",
        );
        forInput.step = "1";

        const fields = [
          createField("Type", type),
          createField("Entity", entity),
          createField("State", stateInput),
          createField("Above", aboveInput),
          createField("Below", belowInput),
          createField("Attribute", attributeInput),
          createField("Expected value", valueInput),
          createField("For", forInput),
        ];

        const updateVisibility = () => {
          const selected = type.value;
          fields[2].hidden = selected !== "state";
          fields[3].hidden = selected !== "numeric";
          fields[4].hidden = selected !== "numeric";
          fields[5].hidden = selected !== "attribute";
          fields[6].hidden = selected !== "attribute";
        };

        type.addEventListener("change", () => {
          condition.type = type.value;
          markDirty();
          updateVisibility();
        });
        entity.addEventListener("change", () => {
          condition.entity_id = entity.value;
          markDirty();
        });

        const controls: Array<[HTMLInputElement, string]> = [
          [stateInput, "state"],
          [aboveInput, "above"],
          [belowInput, "below"],
          [attributeInput, "attribute"],
          [valueInput, "value"],
          [forInput, "for"],
        ];

        for (const [control, key] of controls) {
          control.addEventListener("input", () => {
            condition[key] = control.value;
            markDirty();
          });
        }

        const remove = actionButton(
          "Remove condition",
          "nc-button danger",
        );
        remove.disabled = state.length === 1;
        remove.addEventListener("click", () => {
          state.splice(index, 1);
          markDirty();
          render();
        });

        row.append(
          ...fields,
          remove,
        );
        rows.append(row);
        updateVisibility();
      },
    );
  };

  const add = actionButton(
    "Add condition",
    "nc-button secondary",
  );
  add.addEventListener("click", () => {
    state.push({
      type: "state",
      entity_id: "",
      state: "on",
    });
    markDirty();
    render();
  });

  container.append(rows, add);
  render();

  return () => state.filter(
    (condition) => condition.entity_id,
  );
}
