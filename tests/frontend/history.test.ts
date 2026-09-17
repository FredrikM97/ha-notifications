import { describe, expect, it } from "vitest";
import {
  filterHistoryEntries,
  historyDetailSummary,
} from "../../frontend/history.js";
import { emptyHistoryFilters, historyFixture } from "./conftest.js";

describe("filterHistoryEntries", () => {
  it("matches search text across the event content", () => {
    expect(
      filterHistoryEntries(historyFixture, {
        ...emptyHistoryFilters,
        search: "device",
      }),
    ).toMatchSnapshot();
  });

  it("combines alert, event type, and severity filters", () => {
    expect(
      filterHistoryEntries(historyFixture, {
        ...emptyHistoryFilters,
        alertId: "garage",
        type: "notification_sent",
        severity: "success",
      }),
    ).toMatchSnapshot();
  });

  it("returns all entries when no filters are active", () => {
    expect(
      filterHistoryEntries(historyFixture, emptyHistoryFilters),
    ).toMatchSnapshot();
  });
});

describe("historyDetailSummary", () => {
  it("hides attempt-only details from the inline preview", () => {
    expect(historyDetailSummary({ attempt: 20 })).toMatchSnapshot();
  });

  it("keeps meaningful detail summaries visible", () => {
    expect(
      historyDetailSummary({ error: "Device unavailable" }),
    ).toMatchSnapshot();
  });
});
