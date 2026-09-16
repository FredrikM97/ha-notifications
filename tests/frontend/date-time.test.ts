import { describe, expect, it } from "vitest";
import { formatLocalDateTime } from "../../frontend/date-time.js";

describe("formatLocalDateTime", () => {
  it("uses the user date and time format settings", () => {
    expect(
      formatLocalDateTime("2026-09-15T22:33:33Z", true, {
        language: "en-US",
        date_format: "DMY",
        time_format: "24",
      }),
    ).toMatch(/^15\/09\/2026, 22:33:33$/);
    expect(
      formatLocalDateTime("2026-09-15T22:33:33Z", false, {
        language: "en-US",
        date_format: "MDY",
        time_format: "12",
      }),
    ).toMatch(/^09\/15\/2026, /);
    expect(
      formatLocalDateTime("2026-09-15T22:33:33Z", false, {
        language: "en-US",
        date_format: "YMD",
        time_format: "24",
      }),
    ).toMatch(/^2026\/09\/15, 22:33$/);
  });

  it("returns a placeholder for missing timestamps", () => {
    expect(formatLocalDateTime(undefined)).toBe("—");
  });
});
