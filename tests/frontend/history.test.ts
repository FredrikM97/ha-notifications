// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  filterHistoryEntries,
  historyDetailSummary,
  renderHistory,
} from "../../frontend/history.js";
import {
  emptyHistoryFilters,
  historyFixture,
  mountCustomElement,
  settleElement,
  testUser,
} from "./conftest.js";

function historyContract(root: Element | null) {
  if (!root) {
    return null;
  }

  return {
    filters: [...root.querySelectorAll("ha-input, ha-selector")].map(
      (control) => control.getAttribute("aria-label"),
    ),
    entries: [...root.querySelectorAll(".nc-history-item")].map((entry) => ({
      title: entry.querySelector(".nc-history-alert-link")?.textContent?.trim(),
      badge: entry.querySelector(".nc-history-badge")?.textContent?.trim(),
      hasDetails: Boolean(entry.querySelector(".nc-history-details")),
    })),
    count: root.querySelector(".nc-history-count")?.textContent?.trim(),
  };
}

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

describe("history detail controls", () => {
  it("toggles details without querying the rendered details element", async () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: emptyHistoryFilters,
    });
    const user = testUser();
    const item = container.querySelector(".nc-history-item.clickable");
    const details = item?.querySelector("details");

    expect(details?.hasAttribute("open")).toBe(false);
    await user.click(item!);
    expect(item?.querySelector("details")?.hasAttribute("open")).toBe(true);
  });
});

describe("history view element", () => {
  it("renders the registered history view", async () => {
    const element = mountCustomElement<HTMLElement>(
      "ha-notifications-history-view",
      {
        history: historyFixture,
        options: { filters: emptyHistoryFilters },
      },
    );
    await settleElement(element);

    expect(historyContract(element.querySelector(".nc-history"))).toMatchSnapshot();
  });

  it("updates when its filters change", async () => {
    const element = mountCustomElement<HTMLElement>(
      "ha-notifications-history-view",
      {
        history: historyFixture,
        options: { filters: emptyHistoryFilters },
      },
    );
    await settleElement(element);

    element.options = {
      filters: { ...emptyHistoryFilters, severity: "error" },
    };
    await settleElement(element);

    expect(element.querySelectorAll(".nc-history-item")).toHaveLength(1);
  });
});
