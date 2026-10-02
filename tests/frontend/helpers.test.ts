import { describe, expect, it } from "vitest";
import { durationInputValue } from "../../frontend/components/duration-input.js";
import {
  actionArrayValue,
  conditionYaml,
  parseConditionYaml,
  parseTriggerYaml,
  triggerYaml,
} from "../../frontend/editor/serialization.js";
import { confirmationNotificationEnabled } from "../../frontend/editor/confirmation.js";
import { customTriggers, mergeCustomTriggers } from "../../frontend/editor/triggers.js";
import { enabledLabel } from "../../frontend/editor/navigation.js";
import {
  DEFAULT_INTERVAL,
  intervalValue,
  patternForDuration,
} from "../../frontend/editor/triggers.js";

describe("repeat trigger pattern", () => {
  it("defaults to every 12 hours", () => {
    expect(DEFAULT_INTERVAL).toBe("12:00:00");
    expect(intervalValue(undefined)).toBe("12:00:00");
    expect(patternForDuration("00:00:00")).toEqual({
      trigger: "time_pattern",
      hours: "/12",
    });
  });

  it("keeps divisors within Home Assistant time_pattern limits", () => {
    expect(
      ["00:00:30", "00:15:00", "01:30:00", "06:00:00", "23:40:00", "48:00:00"].map(
        patternForDuration,
      ),
    ).toEqual([
      { trigger: "time_pattern", seconds: "/30" },
      { trigger: "time_pattern", minutes: "/15" },
      { trigger: "time_pattern", hours: "/2" },
      { trigger: "time_pattern", hours: "/6" },
      { trigger: "time_pattern", hours: "/23" },
      { trigger: "time_pattern", hours: 0, minutes: 0, seconds: 0 },
    ]);
  });

  it("round-trips the daily pattern to a 24 hour duration", () => {
    expect(intervalValue(patternForDuration("24:00:00"))).toBe("24:00:00");
  });
});

describe("optional alert conditions", () => {
  it("round-trips an empty condition editor", () => {
    expect(conditionYaml([])).toBe("");
    expect(parseConditionYaml("")).toEqual([]);
  });
});

describe("durationInputValue", () => {
  it.each([
    ["HH:MM", "01:30", "00:00:00"],
    ["long HH:MM:SS", "100:00:00", "00:00:00"],
    ["object values", { hours: 1, minutes: 5, seconds: 9 }, "00:00:00"],
    ["native days", { days: 2, hours: 3, minutes: 4, seconds: 5 }, "00:00:00"],
    ["missing values", undefined, "00:30:00"],
  ] as const)("normalizes %s input", (_scenario, value, fallback) => {
    expect(durationInputValue(value, fallback)).toMatchSnapshot();
  });
});

describe("enabledLabel", () => {
  it("reflects the enabled flag", () => {
    expect([enabledLabel(true), enabledLabel(false)]).toMatchSnapshot();
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

describe("customTriggers", () => {
  it("separates built-in startup and repeat triggers from custom triggers", () => {
    const configured = [
      { trigger: "homeassistant", event: "start" },
      { trigger: "time_pattern", minutes: "/5" },
      { trigger: "state", entity_id: "sensor.temperature" },
    ];

    expect(customTriggers(configured)).toEqual([
      { trigger: "state", entity_id: "sensor.temperature" },
    ]);
  });

  it("merges custom triggers with the currently configured built-ins", () => {
    const current = [
      { trigger: "homeassistant", event: "start" },
      { trigger: "time_pattern", minutes: "/5" },
      { trigger: "state", entity_id: "sensor.old" },
    ];
    const custom = [
      { trigger: "state", entity_id: "sensor.temperature" },
    ];

    expect(mergeCustomTriggers(current, custom)).toEqual([
      { trigger: "homeassistant", event: "start" },
      { trigger: "time_pattern", minutes: "/5" },
      { trigger: "state", entity_id: "sensor.temperature" },
    ]);
  });

  it("shows an empty editor for an empty custom trigger list", () => {
    expect(triggerYaml([])).toBe("");
    expect(parseTriggerYaml("  \n")).toEqual([]);
  });

  it("parses multiple YAML trigger mappings", () => {
    expect(parseTriggerYaml(
      "- trigger: state\n  entity_id: binary_sensor.front_door\n- trigger: event\n  event_type: example\n",
    )).toEqual([
      { trigger: "state", entity_id: "binary_sensor.front_door" },
      { trigger: "event", event_type: "example" },
    ]);
  });
});

describe("confirmationNotificationEnabled", () => {
  it("preserves legacy behavior when an empty data mapping is present", () => {
    expect(confirmationNotificationEnabled({ data: {} })).toBe(true);
    expect(
      confirmationNotificationEnabled({ enabled: false, data: {} }),
    ).toBe(false);
  });

  it("preserves configured legacy follow-ups unless explicitly disabled", () => {
    expect(confirmationNotificationEnabled({ message: "Done" })).toBe(true);
    expect(
      confirmationNotificationEnabled({ enabled: false, message: "Done" }),
    ).toBe(false);
  });
});
