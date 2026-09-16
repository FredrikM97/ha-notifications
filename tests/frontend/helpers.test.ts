import { describe, expect, it } from "vitest";
import {
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
    ).toBe("51:04:05");
  });

  it("falls back for missing/invalid values", () => {
    expect(durationInputValue(undefined, "00:30:00")).toMatchSnapshot();
  });
});

describe("enabledLabel", () => {
  it("reflects the enabled flag", () => {
    expect(enabledLabel(true)).toBe("Enabled");
    expect(enabledLabel(false)).toBe("Disabled");
  });
});

describe("toggleTitle", () => {
  it("describes the action the toggle performs next", () => {
    expect(toggleTitle(true, "confirmation")).toBe("Disable confirmation");
    expect(toggleTitle(false, "confirmation")).toBe("Enable confirmation");
  });
});
