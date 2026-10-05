// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  filterHistoryEntries,
  groupHistoryEntries,
  historyDetailSummary,
  historyStartedBySummary,
  renderHistory,
} from "../../frontend/history.js";
import type { HistoryFilters } from "../../frontend/history.js";
import {
  emptyHistoryFilters,
  cleanupTestDom,
  historyFixture,
  mountCustomElement,
  settleElement,
  testUser,
} from "./conftest.js";

afterEach(cleanupTestDom);

function historyContract(root: ParentNode | null) {
  if (!root) {
    return null;
  }

  const filterRoot = root.querySelector("ha-notifications-history-filter")?.shadowRoot;
  const entriesRoot = root.querySelector("ha-notifications-history-entries")?.shadowRoot;

  return {
    filters: [...(filterRoot?.querySelectorAll("ha-input, ha-selector") || [])].map(
      (control) => control.getAttribute("aria-label"),
    ),
    entries: [...(entriesRoot?.querySelectorAll(".nc-history-item") || [])].map((entry) => ({
      title: entry.querySelector(".nc-history-alert-link")?.textContent?.trim(),
      badge: entry.querySelector(".nc-history-badge")?.textContent?.trim(),
      flow: entry.querySelector(".nc-history-flow")?.textContent?.trim(),
      hasDetails: Boolean(entry.querySelector(".nc-history-details")),
    })),
    count: entriesRoot?.querySelector(".nc-history-count")?.textContent?.trim(),
  };
}

function historyFilterRoot(element: HTMLElement): ShadowRoot {
  return element.shadowRoot!.querySelector("ha-notifications-history-filter")!.shadowRoot!;
}

function historyEntriesRoot(element: HTMLElement): ShadowRoot {
  return element.shadowRoot!.querySelector("ha-notifications-history-entries")!.shadowRoot!;
}

async function settleHistory(element: HTMLElement): Promise<void> {
  if (element.isConnected) {
    await settleElement(element);
  } else {
    await Promise.resolve();
  }
  for (const selector of [
    "ha-notifications-history-filter",
    "ha-notifications-history-entries",
  ]) {
    const child = element.shadowRoot?.querySelector<HTMLElement>(selector);
    (child as (HTMLElement & { performUpdate?: () => void }) | null)
      ?.performUpdate?.();
  }
  await Promise.resolve();
}

describe("filterHistoryEntries", () => {
  it.each([
    ["event content search", { ...emptyHistoryFilters, search: "device" }],
    ["combined alert, event, and severity filters", {
      ...emptyHistoryFilters,
      alertId: "garage",
      type: "notification_sent",
      severity: "success",
    }],
    ["no active filters", emptyHistoryFilters],
  ] satisfies [string, HistoryFilters][]) (
    "snapshots entries for %s",
    (_scenario, filters) => {
      expect(filterHistoryEntries(historyFixture, filters)).toMatchSnapshot();
    },
  );
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

describe("historyStartedBySummary", () => {
  it("summarizes a state trigger and its transition", () => {
    expect(historyStartedBySummary({
      started_by: {
        platform: "state",
        entity_id: "input_boolean.alert_button",
        from_state: "off",
        to_state: "on",
      },
    })).toBe("input_boolean.alert_button (off -> on)");
  });

  it("summarizes event triggers", () => {
    expect(historyStartedBySummary({
      started_by: { platform: "homeassistant", event_type: "homeassistant_started" },
    })).toBe("homeassistant event homeassistant_started");
  });
});

describe("history filter controls", () => {
  it("emits filter changes as a bubbling composed event", async () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: emptyHistoryFilters,
    });

    const element = container.querySelector("ha-notifications-history-view")!;
    await settleHistory(element);
    let filterDetail: HistoryFilters | undefined;
    let receivedEvent: Event | undefined;
    element.addEventListener("history-filters-changed", (event) => {
      receivedEvent = event;
      filterDetail = (event as CustomEvent<HistoryFilters>).detail;
    });

    const search = historyFilterRoot(element).querySelector(
      ".nc-history-search",
    ) as HTMLElement & { value: string };
    search.value = "garage";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    expect(filterDetail?.search).toBe("garage");
    expect(receivedEvent?.bubbles).toBe(true);
    expect(receivedEvent?.composed).toBe(true);
  });

  it("keeps secondary filters collapsed until one is active", async () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: emptyHistoryFilters,
      alerts: [{ id: "garage", name: "Garage" }],
      types: ["notification_sent"],
    });

    const element = container.querySelector("ha-notifications-history-view")!;
    await settleHistory(element);
    const details = historyFilterRoot(element).querySelector(".nc-history-filter-details");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(historyFilterRoot(element).querySelectorAll("ha-selector")).toHaveLength(3);
  });

  it("keeps filter selector configs stable across rerenders", async () => {
    const container = document.createElement("div");
    const options = {
      filters: emptyHistoryFilters,
      alerts: [{ id: "garage", name: "Garage" }],
      types: ["notification_sent"],
    };
    renderHistory(container, historyFixture, options);

    const element = container.querySelector("ha-notifications-history-view")!;
    await settleHistory(element);
    const selectors = [...historyFilterRoot(element).querySelectorAll<
      HTMLElement & { selector: Record<string, unknown> }
    >("ha-selector")];
    const configs = selectors.map((selector) => selector.selector);

    renderHistory(container, historyFixture, options);

    expect(selectors.map((selector) => selector.selector)).toEqual(configs);
    selectors.forEach((selector, index) =>
      expect(selector.selector).toBe(configs[index]),
    );
  });

  it("opens secondary filters when one is active", async () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: { ...emptyHistoryFilters, severity: "error" },
      types: ["notification_sent"],
    });

    const element = container.querySelector("ha-notifications-history-view")!;
    await settleHistory(element);
    expect(historyFilterRoot(element).querySelector(".nc-history-filter-details")?.hasAttribute("open")).toBe(true);
  });
});

describe("history detail controls", () => {
  it("toggles details without querying the rendered details element", async () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, {
      filters: emptyHistoryFilters,
    });
    const element = container.querySelector("ha-notifications-history-view")!;
    await settleHistory(element);
    const root = historyEntriesRoot(element);
    const user = testUser();
    const item = root?.querySelector(".nc-history-item.clickable");
    const details = item?.querySelector("details");

    expect(details?.hasAttribute("open")).toBe(false);
    await user.click(item!);
    expect(item?.querySelector("details")?.hasAttribute("open")).toBe(true);
  });
});

describe("history entries events", () => {
  it("bubbles alert selection through the entries and history components", async () => {
    const container = document.createElement("div");
    renderHistory(container, historyFixture, { filters: emptyHistoryFilters });
    const element = container.querySelector("ha-notifications-history-view")!;
    await settleHistory(element);

    let detail: { alertId: string; alertName: string } | undefined;
    element.addEventListener("history-alert-selected", (event) => {
      detail = (event as CustomEvent<{ alertId: string; alertName: string }>).detail;
    });
    historyEntriesRoot(element)
      .querySelector<HTMLButtonElement>(".nc-history-alert-link")!
      .click();

    expect(detail).toEqual({ alertId: "garage", alertName: "Garage door" });
  });
});

describe("history view element", () => {
  it("shows why a confirmation follow-up notification was sent", async () => {
    const confirmationEntry = {
      ...historyFixture[0],
      event: {
        ...historyFixture[0].event,
        details: {
          service: "notify.mobile_app_phone",
          reason: "confirmation_notification",
        },
      },
    };
    const element = mountCustomElement<HTMLElement>(
      "ha-notifications-history-view",
      {
        history: [confirmationEntry],
        options: { filters: emptyHistoryFilters },
      },
    );
    await settleHistory(element);

    expect(historyEntriesRoot(element).querySelector(".nc-history-reason")?.textContent)
      .toBe("Reason: Confirmation notification");
  });

  it("shows which trigger started an automation", async () => {
    const startedEntry = {
      ...historyFixture[0],
      event: {
        ...historyFixture[0].event,
        type: "started",
        details: {
          action: "automation_started",
          started_by: {
            platform: "state",
            entity_id: "input_boolean.alert_button",
            from_state: "off",
            to_state: "on",
          },
        },
      },
    };
    const element = mountCustomElement<HTMLElement>(
      "ha-notifications-history-view",
      {
        history: [startedEntry],
        options: { filters: emptyHistoryFilters },
      },
    );
    await settleHistory(element);

    expect(historyEntriesRoot(element).querySelector(".nc-history-origin")?.textContent)
      .toContain("Started by input_boolean.alert_button (off -> on)");
  });

  it("renders the registered history view", async () => {
    const element = mountCustomElement<HTMLElement>(
      "ha-notifications-history-view",
      {
        history: historyFixture,
        options: { filters: emptyHistoryFilters },
      },
    );
    await settleHistory(element);

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
    await settleHistory(element);

    element.options = {
      filters: { ...emptyHistoryFilters, severity: "error" },
    };
    await settleHistory(element);

    expect(historyEntriesRoot(element).querySelectorAll(".nc-history-item")).toHaveLength(1);
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
    await settleHistory(element);

    const root = historyEntriesRoot(element);
    expect(root.querySelectorAll(".nc-history-flow-group")).toHaveLength(1);
    expect(root.querySelectorAll(".nc-history-item")).toHaveLength(2);
    const group = root.querySelector<HTMLDetailsElement>(
      ".nc-history-flow-group",
    );
    expect(group?.open).toBe(false);
    expect(group?.querySelector(".nc-history-flow-heading")?.textContent).toContain(
      "Flow flow_garage",
    );
    expect(group?.querySelector(".nc-history-flow-alert")?.textContent).toContain(
      "Alert: Garage door",
    );
    group!.open = true;
    expect(group?.open).toBe(true);
  });
});
