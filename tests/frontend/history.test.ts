// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  filterHistoryEntries,
  historyDetailSummary,
  renderHistory,
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

describe("history filter controls", () => {
  it("keeps secondary filters collapsed until one is active", () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: emptyHistoryFilters,
      alerts: [{ id: "garage", name: "Garage" }],
      types: ["notification_sent"],
    });

    const details = container.querySelector(".nc-history-filter-details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(container.querySelectorAll("ha-selector")).toHaveLength(3);
  });

  it("opens secondary filters when one is active", () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: { ...emptyHistoryFilters, severity: "error" },
      types: ["notification_sent"],
    });

    expect(
      container
        .querySelector(".nc-history-filter-details")
        ?.hasAttribute("open"),
    ).toBe(true);
  });
});
