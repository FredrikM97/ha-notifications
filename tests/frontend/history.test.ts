import { describe, expect, it } from "vitest";
import {
  filterHistoryEntries,
  historyMessage,
} from "../../frontend/history.js";
import type { HistoryEntry } from "../../frontend/types.js";

const history: HistoryEntry[] = [
  {
    alert_id: "garage",
    alert_name: "Garage door",
    type: "notification_sent",
    message: "The garage is open",
    details: { source: "sensor" },
  },
  {
    alert_id: "water",
    alert_name: "Water leak",
    type: "delivery_failed",
    message: "Could not notify",
    details: { error: "Device unavailable" },
  },
];

const emptyFilters = {
  search: "",
  alertId: "",
  type: "",
  severity: "",
};

describe("filterHistoryEntries", () => {
  it("matches search text across the event content", () => {
    expect(
      filterHistoryEntries(history, { ...emptyFilters, search: "device" }),
    ).toEqual([history[1]]);
  });

  it("combines alert, event type, and severity filters", () => {
    expect(
      filterHistoryEntries(history, {
        ...emptyFilters,
        alertId: "garage",
        type: "notification_sent",
        severity: "success",
      }),
    ).toEqual([history[0]]);
  });

  it("returns all entries when no filters are active", () => {
    expect(filterHistoryEntries(history, emptyFilters)).toEqual(history);
  });
});

describe("historyMessage", () => {
  it("hides the redundant notification sent message when attempt details exist", () => {
    expect(
      historyMessage({
        type: "notification_sent",
        message: "Notification sent.",
        details: { attempt: 20 },
      }),
    ).toBe("");
  });

  it("keeps other history messages", () => {
    expect(
      historyMessage({
        type: "delivery_failed",
        message: "Notification failed.",
        details: { attempt: 20 },
      }),
    ).toBe("Notification failed.");
  });
});
