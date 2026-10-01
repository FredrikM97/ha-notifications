// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  filterHistoryEntries,
  groupHistoryEntries,
  historyDetailSummary,
  renderHistory,
} from "../../frontend/history.js";
import type { HistoryFilters } from "../../frontend/history.js";
import {
  emptyHistoryFilters,
  historyFixture,
  mountCustomElement,
  settleElement,
  testUser,
} from "./conftest.js";

function historyContract(root: ParentNode | null) {
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
      flow: entry.querySelector(".nc-history-flow")?.textContent?.trim(),
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

describe("groupHistoryEntries", () => {
  it("groups flow events while keeping standalone events separate", () => {
    const grouped = groupHistoryEntries([
      historyFixture[0],
      { ...historyFixture[0], event: { ...historyFixture[0].event, event_id: "event_garage_2" } },
      historyFixture[1],
    ]);

    expect(grouped).toEqual([
      { flowId: "flow_garage", entries: [historyFixture[0], expect.anything()] },
      { entries: [historyFixture[1]] },
    ]);
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
  it("emits filter changes as a bubbling composed event", () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: emptyHistoryFilters,
    });

    const element = container.querySelector("ha-notifications-history-view")!;
    let filterDetail: HistoryFilters | undefined;
    let receivedEvent: Event | undefined;
    element.addEventListener("history-filters-changed", (event) => {
      receivedEvent = event;
      filterDetail = (event as CustomEvent<HistoryFilters>).detail;
    });

    const search = element.shadowRoot!.querySelector(
      ".nc-history-search",
    ) as HTMLElement & { value: string };
    search.value = "garage";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    expect(filterDetail?.search).toBe("garage");
    expect(receivedEvent?.bubbles).toBe(true);
    expect(receivedEvent?.composed).toBe(true);
  });

  it("keeps secondary filters collapsed until one is active", () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: emptyHistoryFilters,
      alerts: [{ id: "garage", name: "Garage" }],
      types: ["notification_sent"],
    });

    const root = container.querySelector("ha-notifications-history-view")?.shadowRoot;
    const details = root?.querySelector(".nc-history-filter-details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(root?.querySelectorAll("ha-selector")).toHaveLength(3);
  });

  it("opens secondary filters when one is active", () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: { ...emptyHistoryFilters, severity: "error" },
      types: ["notification_sent"],
    });

    const root = container.querySelector("ha-notifications-history-view")?.shadowRoot;
    expect(root?.querySelector(".nc-history-filter-details")?.hasAttribute("open")).toBe(true);
  });
});

describe("history detail controls", () => {
  it("toggles details without querying the rendered details element", async () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: emptyHistoryFilters,
    });
    const root = container.querySelector("ha-notifications-history-view")?.shadowRoot;
    const user = testUser();
    const item = root?.querySelector(".nc-history-item.clickable");
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

    expect(historyContract(element.shadowRoot?.querySelector(".nc-history") || null)).toMatchSnapshot();
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

    expect(element.shadowRoot?.querySelectorAll(".nc-history-item")).toHaveLength(1);
  });

  it("renders grouped flow events only when enabled", async () => {
    const element = mountCustomElement<HTMLElement>(
      "ha-notifications-history-view",
      {
        history: [
          historyFixture[0],
          {
            ...historyFixture[0],
            event: { ...historyFixture[0].event, event_id: "event_garage_2" },
          },
        ],
        options: { filters: emptyHistoryFilters, groupByFlow: true },
      },
    );
    await settleElement(element);

    const root = element.shadowRoot!;
    expect(root.querySelectorAll(".nc-history-flow-group")).toHaveLength(1);
    expect(root.querySelectorAll(".nc-history-item")).toHaveLength(2);
    const group = root.querySelector<HTMLDetailsElement>(
      ".nc-history-flow-group",
    );
    expect(group?.open).toBe(true);
    expect(group?.querySelector(".nc-history-flow-heading")?.textContent).toContain(
      "Flow flow_garage",
    );
    group!.open = false;
    expect(group?.open).toBe(false);
  });
});
