import { describe, expect, it } from "vitest";
import {
  actionArrayValue,
  durationInputValue,
  enabledLabel,
  toggleTitle,
} from "../../frontend/editor/helpers.js";

describe("durationInputValue", () => {
  it("pads an HH:MM string to HH:MM:SS", () => {
    expect(durationInputValue("01:30", "00:00:00")).toMatchSnapshot();
  });

  it("passes an HH:MM:SS string through unchanged", () => {
    expect(durationInputValue("100:00:00", "00:00:00")).toMatchSnapshot();
  });

  it("converts an hours/minutes/seconds object", () => {
    expect(
      durationInputValue({ hours: 1, minutes: 5, seconds: 9 }, "00:00:00"),
    ).toMatchSnapshot();
  });

  it("includes days from a native duration value", () => {
    expect(
      durationInputValue(
        { days: 2, hours: 3, minutes: 4, seconds: 5 },
        "00:00:00",
      ),
    ).toMatchSnapshot();
  });

  it("falls back for missing/invalid values", () => {
    expect(durationInputValue(undefined, "00:30:00")).toMatchSnapshot();
  });
});

describe("enabledLabel", () => {
  it("reflects the enabled flag", () => {
    expect([enabledLabel(true), enabledLabel(false)]).toMatchSnapshot();
  });
});

describe("toggleTitle", () => {
  it("describes the action the toggle performs next", () => {
    expect([
      toggleTitle(true, "confirmation"),
      toggleTitle(false, "confirmation"),
    ]).toMatchSnapshot();
  });
});

describe("actionArrayValue", () => {
  it("parses YAML action lists", () => {
    expect(
      actionArrayValue(
        { value: "- action: light.turn_on\n  target:\n    entity_id: light.kitchen" },
        "Post-send actions",
      ),
    ).toEqual([
      {
        action: "light.turn_on",
        target: { entity_id: "light.kitchen" },
      },
    ]);
  });

  it("accepts JSON arrays because JSON is valid YAML", () => {
    expect(
      actionArrayValue(
        { value: '[{"action":"switch.turn_on"}]' },
        "Post-send actions",
      ),
    ).toEqual([{ action: "switch.turn_on" }]);
  });

  it.each([
    ["not: [valid", "valid YAML list of action objects"],
    ["action: light.turn_on", "YAML list of action objects"],
    ["- invalid", "YAML list of action objects"],
  ])("rejects %s", (value, message) => {
    expect(() => actionArrayValue({ value }, "Post-send actions")).toThrow(
      message,
    );
  });
});
